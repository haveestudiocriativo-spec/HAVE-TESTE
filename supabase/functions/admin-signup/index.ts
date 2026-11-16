import { createClient } from 'npm:@supabase/supabase-js@2';

// Solicitação pública de acesso ao painel. Cria o usuário já BLOQUEADO (banned) e registra um pedido
// pendente. Nada dá acesso até que outro administrador aprove (função admin-users).
// A senha vai direto ao Supabase Auth (hash); não é guardada em nenhuma tabela nossa.
// Deploy: verify_jwt = false (é pública, chamada da tela de login).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@,()<>"';]+@[^\s@,()<>"';]+\.[^\s@,()<>"';]{2,}$/;
const OK = { ok: true, message: 'Solicitação enviada. Você poderá entrar depois que um administrador aprovar.' };
const FOREVER = '876000h';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'JSON inválido.' }); }

  if (body.website) return json(200, OK); // honeypot anti-bot (sem pista para o robô)

  const username = String(body.username ?? '').trim().toLowerCase();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!USERNAME_RE.test(username)) return json(400, { error: 'Usuário inválido: use de 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.' });
  if (!EMAIL_RE.test(email) || email.length > 160) return json(400, { error: 'E-mail inválido.' });
  if (password.length < 8) return json(400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (password.length > 200) return json(400, { error: 'Senha muito longa.' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ip = (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim().slice(0, 64) || null;

  // Limites: 3 pedidos por IP por hora e no máximo 25 pendentes no total.
  if (ip) {
    const { count } = await admin.from('admin_requests').select('id', { count: 'exact', head: true })
      .eq('ip', ip).gt('created_at', new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= 3) return json(429, { error: 'Muitas solicitações. Tente novamente mais tarde.' });
  }
  const { count: pending } = await admin.from('admin_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if ((pending ?? 0) >= 25) return json(429, { error: 'Há muitas solicitações pendentes. Tente novamente mais tarde.' });

  // Avisos claros: o usuário precisa saber por que o pedido não foi criado.
  const { data: takenProfile } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (takenProfile) return json(409, { error: 'Este nome de usuário já está em uso. Escolha outro.' });
  const { data: takenName } = await admin.from('admin_requests').select('id').eq('status', 'pending').eq('username', username).maybeSingle();
  if (takenName) return json(409, { error: 'Já existe uma solicitação pendente com esse nome de usuário.' });
  const { data: takenMail } = await admin.from('admin_requests').select('id').eq('status', 'pending').eq('email', email).maybeSingle();
  if (takenMail) return json(409, { error: 'Já existe uma solicitação pendente com esse e-mail. Aguarde a aprovação.' });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, ban_duration: FOREVER,
  });
  if (createErr || !created?.user) {
    const dup = /already|registered|exists/i.test(createErr?.message ?? '') || createErr?.status === 422;
    return json(dup ? 409 : 400, { error: dup ? 'Este e-mail já tem cadastro. Tente entrar ou use outro e-mail.' : 'Não foi possível enviar a solicitação. Confira a senha e tente de novo.' });
  }

  const { error: reqErr } = await admin.from('admin_requests').insert({ user_id: created.user.id, username, email, ip });
  if (reqErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(400, { error: 'Não foi possível enviar a solicitação. Tente de novo.' });
  }
  return json(201, OK);
});
