import { createClient } from 'npm:@supabase/supabase-js@2';

// Gestão de usuários do painel. Só administradores (quem tem linha em public.profiles) podem chamar.
//   POST   { username, email, password }   cadastra um administrador diretamente
//   POST   { action: 'approve'|'reject', id }  decide uma solicitação de acesso
//   DELETE { id }                          remove um administrador
// Deploy: verify_jwt = true. Usa a service_role (variável automática do Supabase), nunca no navegador.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@,()<>"';]+@[^\s@,()<>"';]+\.[^\s@,()<>"';]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Identifica quem está chamando pelo JWT e exige que seja administrador.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json(401, { error: 'Não autorizado.' });
  const { data: callerProfile } = await admin.from('profiles').select('id, username').eq('id', caller.user.id).maybeSingle();
  if (!callerProfile) return json(403, { error: 'Sem permissão.' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }

  if (req.method === 'POST') {
    const action = String(body.action ?? 'create');

    // ---- Aprovar / recusar solicitação de acesso ----
    if (action === 'approve' || action === 'reject') {
      const id = String(body.id ?? '');
      if (!UUID_RE.test(id)) return json(400, { error: 'Solicitação inválida.' });
      const { data: r } = await admin.from('admin_requests').select('*').eq('id', id).eq('status', 'pending').maybeSingle();
      if (!r) return json(404, { error: 'Solicitação não encontrada ou já decidida.' });
      const now = new Date().toISOString();

      if (action === 'reject') {
        // O usuário bloqueado nunca teve acesso; some do Auth.
        await admin.auth.admin.deleteUser(r.user_id);
        await admin.from('admin_requests').update({ status: 'rejected', decided_by: caller.user.id, decided_at: now }).eq('id', id);
        return json(200, { ok: true });
      }

      const { error: profileErr } = await admin.from('profiles').insert({ id: r.user_id, username: r.username, created_by: caller.user.id });
      if (profileErr) return json(409, { error: 'Não foi possível aprovar (o nome de usuário já está em uso?).' });
      const { error: unbanErr } = await admin.auth.admin.updateUserById(r.user_id, { ban_duration: 'none' });
      if (unbanErr) {
        await admin.from('profiles').delete().eq('id', r.user_id);
        return json(400, { error: 'Não foi possível liberar o acesso.' });
      }
      await admin.from('admin_requests').update({ status: 'approved', decided_by: caller.user.id, decided_at: now }).eq('id', id);
      return json(200, { ok: true, username: r.username });
    }

    // ---- Cadastro direto por um administrador ----
    const username = String(body.username ?? '').trim().toLowerCase();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!USERNAME_RE.test(username)) return json(400, { error: 'Usuário inválido: use de 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.' });
    if (!EMAIL_RE.test(email) || email.length > 160) return json(400, { error: 'E-mail inválido.' });
    if (password.length < 8) return json(400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (password.length > 200) return json(400, { error: 'Senha muito longa.' });

    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) return json(409, { error: 'Já existe um usuário com esse nome.' });

    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr || !created?.user) {
      const dup = /already|registered|exists/i.test(createErr?.message ?? '');
      return json(dup ? 409 : 400, { error: dup ? 'Já existe um usuário com esse e-mail.' : 'Não foi possível criar o usuário.' });
    }

    const { error: profileErr } = await admin.from('profiles').insert({ id: created.user.id, username, created_by: caller.user.id });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(400, { error: 'Não foi possível criar o usuário.' });
    }
    return json(201, { id: created.user.id, username });
  }

  if (req.method === 'DELETE') {
    const id = String(body.id ?? '');
    if (!UUID_RE.test(id)) return json(400, { error: 'Usuário inválido.' });
    if (id === caller.user.id) return json(400, { error: 'Você não pode excluir o próprio usuário.' });
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    if ((count ?? 0) <= 1) return json(400, { error: 'O painel precisa ter pelo menos um usuário.' });
    const { data: target } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
    if (!target) return json(404, { error: 'Usuário não encontrado.' });
    // Apaga o usuário do Auth; o perfil some em cascata e as sessões deixam de valer.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) return json(400, { error: 'Não foi possível remover o usuário.' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Método não permitido.' });
});
