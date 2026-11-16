'use strict';

/*
 * Have Studio Criativo — backend simples em Node.js (sem dependências).
 *
 *  - Serve o site estático em /public (com suporte a Range para streaming de vídeo)
 *  - API pública:  GET  /api/projects        lista os projetos do portfólio
 *                  GET  /api/projects/:id    detalhes de um projeto
 *                  POST /api/contact         recebe o formulário de contato
 *  - O painel (/admin.html) usa Supabase (Auth, banco e Storage). As rotas /api/admin/* abaixo
 *    são do sistema antigo e só funcionam com LEGACY_ADMIN=1.
 *  - Login do painel antigo: POST /api/admin/login { username, password } → { token }
 *                    POST /api/admin/logout | GET /api/admin/me | POST /api/admin/password
 *                    GET/POST /api/admin/users, DELETE /api/admin/users/:id
 *  - API admin (Authorization: Bearer <token da sessão>):
 *                  GET    /api/admin/projects       lista tudo (inclusive ocultos)
 *                  POST   /api/admin/projects       cria projeto
 *                  PUT    /api/admin/projects/:id   atualiza projeto
 *                  DELETE /api/admin/projects/:id   remove projeto
 *                  POST   /api/admin/upload?name=x&project=id  envia mídia para um projeto
 *                  GET    /api/admin/contacts       mensagens recebidas
 *
 * Uso:  npm start   →  http://localhost:3000
 *       Na primeira execução é criado o usuário "admin" com a senha de ADMIN_TOKEN
 *       (mín. 12 caracteres) ou, se não definida, uma senha aleatória exibida no console.
 *       Senhas padrão conhecidas (ex.: "have-admin") são trocadas automaticamente na inicialização.
 *       Atrás de proxy reverso (HTTPS), defina TRUST_PROXY=1.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const util = require('util');

const PORT = Number(process.env.PORT) || 3000;
// Senha inicial do usuário "admin". Se ADMIN_TOKEN não for definido (ou for fraco/conhecido),
// uma senha aleatória é gerada e mostrada uma única vez no console.
const KNOWN_DEFAULT_PASSWORDS = ['have-admin', 'admin', 'password', 'changeme'];
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// Só confie em X-Forwarded-For quando houver um proxy reverso confiável na frente (TRUST_PROXY=1).
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
// Endereço público do site (ex.: https://www.haveestudiocriativo.com.br). Usado em canonical,
// Open Graph, sitemap.xml e robots.txt. Sem barra no final.
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).trim().replace(/\/+$/, '');
// Redireciona http -> https (só quando TRUST_PROXY=1 e o proxy informa o protocolo).
const FORCE_HTTPS = /^(1|true|yes)$/i.test(process.env.FORCE_HTTPS || '');
// O painel (admin.html) usa Supabase Auth. A API /api/admin/* e o login por users.json abaixo são
// o sistema ANTIGO e ficam desligados, salvo LEGACY_ADMIN=1 (ex.: para ler /api/admin/lgpd-requests).
const LEGACY_ADMIN = /^(1|true|yes)$/i.test(process.env.LEGACY_ADMIN || '');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'media', 'portfolio');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const CONTACT_MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');
const CONTACT_INFO_FILE = path.join(DATA_DIR, 'contacts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LGPD_REQUESTS_FILE = path.join(DATA_DIR, 'lgpd-requests.json');

const MAX_JSON_BYTES = 1024 * 1024; // 1 MB
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const UPLOAD_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp']);
const CATEGORIES = ['Publicidade', 'Entretenimento', 'Institucional', 'Videoclipe', 'Documentário', 'Eventos'];

/* ------------------------------------------------------------------ */
/* Armazenamento em arquivos JSON                                      */
/* ------------------------------------------------------------------ */

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

// Fila única de escrita: evita que duas requisições simultâneas sobrescrevam
// o mesmo arquivo com versões diferentes (read → modify → write).
let queue = Promise.resolve();
function mutate(file, fallback, fn) {
  const job = queue.then(async () => {
    const data = await readJSON(file, fallback);
    const result = await fn(data);
    await writeJSON(file, data);
    return result;
  });
  queue = job.catch(() => {});
  return job;
}

/* ------------------------------------------------------------------ */
/* Utilidades HTTP                                                     */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Cabeçalhos de segurança aplicados a todas as respostas.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' blob: https:",
  "frame-src https://www.google.com",
  "connect-src 'self' https://gkypknwysbswbciptqpu.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function applySecurityHeaders(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const https = req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim() === 'https');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Conteúdo muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const raw = await readBody(req, MAX_JSON_BYTES);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

function clientIp(req) {
  if (TRUST_PROXY) {
    // O último valor é o que o NOSSO proxy acrescentou; os anteriores podem ser forjados pelo cliente.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return req.socket.remoteAddress || '';
}

// Limpa periodicamente mapas de limite/sessões para não crescerem sem fim.
function sweep(map, windowMs) {
  const now = Date.now();
  for (const [k, hits] of map) {
    if (!hits.some((t) => now - t < windowMs)) map.delete(k);
  }
}

/* ------------------------------------------------------------------ */
/* Usuários e sessões do painel                                        */
/* ------------------------------------------------------------------ */

const scryptAsync = util.promisify(crypto.scrypt);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h sem uso derruba a sessão
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const SESSION_MAX_MS = 24 * 60 * 60 * 1000; // vida máxima absoluta, mesmo com uso contínuo
const MAX_SESSIONS = 200;
const sessions = new Map(); // token -> { userId, username, expires, created }

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const key = await scryptAsync(String(password), salt, 64);
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

async function checkPassword(user, password) {
  const { hash } = await hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const publicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.createdAt, createdBy: u.createdBy || null });

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (password.length > 200) throw new HttpError(400, 'Senha muito longa.');
}

function getSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now() || s.created + SESSION_MAX_MS < Date.now()) {
    sessions.delete(token);
    return null;
  }
  s.expires = Date.now() + SESSION_TTL_MS;
  return { ...s, token };
}

function requireAdmin(req) {
  const session = getSession(req);
  if (!session) throw new HttpError(401, 'Não autorizado.');
  return session;
}

function initialPassword() {
  if (ADMIN_TOKEN.length >= 12 && !KNOWN_DEFAULT_PASSWORDS.includes(ADMIN_TOKEN.toLowerCase())) {
    return { password: ADMIN_TOKEN, generated: false };
  }
  return { password: crypto.randomBytes(12).toString('base64url'), generated: true };
}

// Garante que exista ao menos um usuário e que nenhum use uma senha padrão conhecida.
async function ensureFirstUser() {
  const users = await readJSON(USERS_FILE, []);
  if (!users.length) {
    const { password, generated } = initialPassword();
    const { salt, hash } = await hashPassword(password);
    await writeJSON(USERS_FILE, [
      { id: crypto.randomUUID(), username: 'admin', salt, hash, createdAt: new Date().toISOString(), createdBy: null },
    ]);
    console.warn('  ⚠  Criado o usuário inicial "admin". Entre no painel e troque a senha.');
    if (generated) console.warn(`  ⚠  Senha inicial gerada (aparece só desta vez): ${password}`);
    return;
  }

  // Usuários existentes com senha padrão conhecida (ex.: "have-admin") ganham uma senha aleatória.
  let changed = false;
  for (const u of users) {
    for (const weak of KNOWN_DEFAULT_PASSWORDS) {
      if (await checkPassword(u, weak)) {
        const password = crypto.randomBytes(12).toString('base64url');
        Object.assign(u, await hashPassword(password), { updatedAt: new Date().toISOString() });
        console.warn(`  ⚠  O usuário "${u.username}" usava uma senha padrão insegura. Nova senha (aparece só desta vez): ${password}`);
        changed = true;
        break;
      }
    }
  }
  if (changed) await writeJSON(USERS_FILE, users);
}

function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Aceita só caminhos locais (/media/...) ou URLs http(s) para os vídeos.
function mediaUrl(v) {
  const s = str(v, 1000);
  if (!s) return '';
  if (/[\\\u0000-\u001f\u007f\s]/.test(s)) throw new HttpError(400, `URL de mídia inválida: ${s}`);
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https:\/\//i.test(s)) return s;
  throw new HttpError(400, `URL de mídia inválida: ${s}`);
}

// Link do filme completo no YouTube (youtube.com ou youtu.be, só https).
const YOUTUBE_RE = /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/[^\s\u0000-\u001f\u007f]+$/i;
function youtubeUrl(v) {
  const s = str(v, 300);
  if (!s) return '';
  if (!YOUTUBE_RE.test(s)) throw new HttpError(400, 'Link do YouTube inválido. Use um endereço https://youtu.be/… ou https://www.youtube.com/watch?v=…');
  return s;
}

function sanitizeProject(input, existing = {}) {
  const p = { ...existing };
  const fields = ['title', 'subtitle', 'client', 'director', 'description'];
  for (const f of fields) if (f in input) p[f] = str(input[f], f === 'description' ? 2000 : 200);
  if ('category' in input) p.category = CATEGORIES.includes(input.category) ? input.category : 'Publicidade';
  if ('year' in input) p.year = Number.parseInt(input.year, 10) || null;
  if ('order' in input) p.order = Number.isFinite(Number(input.order)) ? Number(input.order) : 0;
  if ('published' in input) p.published = Boolean(input.published);
  for (const f of ['video', 'preview', 'videoMobile', 'poster']) if (f in input) p[f] = mediaUrl(input[f]);
  if ('youtube' in input) p.youtube = youtubeUrl(input.youtube);

  if (!p.title) throw new HttpError(400, 'Informe o título do projeto.');
  if (!p.video) throw new HttpError(400, 'Informe o vídeo do projeto.');
  p.category = p.category || 'Publicidade';
  p.published = p.published !== false;
  p.order = p.order ?? 0;
  return p;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateContact(body) {
  const data = {
    name: str(body.name, 120),
    email: str(body.email, 160).toLowerCase(),
    phone: str(body.phone, 40),
    company: str(body.company, 120),
    service: str(body.service, 60),
    message: str(body.message, 3000),
  };
  const errors = {};
  if (data.name.length < 2) errors.name = 'Informe seu nome.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'E-mail inválido.';
  if (data.message.length < 10) errors.message = 'Conte um pouco mais sobre o projeto (mín. 10 caracteres).';
  if (Object.keys(errors).length) throw new HttpError(422, 'Verifique os campos.', errors);
  return data;
}

const LGPD_RELATIONS = ['visitante', 'cliente', 'pessoa-filmada', 'responsavel-legal', 'equipe-parceiro', 'outro'];
const LGPD_REQUEST_TYPES = [
  'confirmacao-acesso', 'correcao', 'anonimizacao-bloqueio-eliminacao', 'eliminacao-consentimento',
  'portabilidade', 'compartilhamento', 'informacao-consentimento', 'revogacao-consentimento',
  'remocao-imagem', 'outro',
];

// Pedido de titular (LGPD, art. 18). Não guardamos IP nem outros dados além do necessário.
function validateLgpdRequest(body) {
  const data = {
    name: str(body.name, 120),
    email: str(body.email, 160).toLowerCase(),
    relation: str(body.relation, 40),
    requests: Array.isArray(body.requests) ? [...new Set(body.requests.filter((r) => LGPD_REQUEST_TYPES.includes(r)))] : [],
    details: str(body.details, 3000),
  };
  const errors = {};
  if (data.name.length < 2) errors.name = 'Informe seu nome.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'E-mail inválido.';
  if (!LGPD_RELATIONS.includes(data.relation)) errors.relation = 'Selecione uma opção.';
  if (!data.requests.length) errors.requests = 'Marque pelo menos uma opção.';
  if (data.details.length < 10) errors.details = 'Descreva o seu pedido (mín. 10 caracteres).';
  if (body.declaration !== true) errors.declaration = 'É necessário confirmar a declaração.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Verifique os campos.', errors);
  return data;
}

// Limite simples: 5 envios por IP a cada 10 minutos (e 100 no total por hora, contra spam distribuído).
const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const MAX_STORED_MESSAGES = 5000;
const contactHits = new Map();
let globalContactHits = [];
function rateLimit(ip) {
  const now = Date.now();
  const hits = (contactHits.get(ip) || []).filter((t) => now - t < CONTACT_WINDOW_MS);
  globalContactHits = globalContactHits.filter((t) => now - t < 60 * 60 * 1000);
  if (hits.length >= 5 || globalContactHits.length >= 100) {
    throw new HttpError(429, 'Muitas mensagens em pouco tempo. Tente novamente mais tarde.');
  }
  hits.push(now);
  globalContactHits.push(now);
  contactHits.set(ip, hits);
}

// Login / troca de senha: limite de tentativas erradas por IP (10) e por usuário (30) a cada 15 minutos.
const loginFails = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function recentFails(key) {
  const now = Date.now();
  const fails = (loginFails.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFails.set(key, fails);
  return fails;
}
const recentLoginFails = (ip) => recentFails(`ip:${ip}`);

setInterval(() => {
  sweep(contactHits, CONTACT_WINDOW_MS);
  sweep(loginFails, LOGIN_WINDOW_MS);
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now || s.created + SESSION_MAX_MS < now) sessions.delete(t);
}, 5 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Rotas da API                                                        */
/* ------------------------------------------------------------------ */

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/* Projetos públicos: vêm do Supabase (o painel grava lá). A chave publishable é pública por
   desenho; a RLS da tabela só entrega projetos publicados. Se o Supabase falhar, usa o JSON local. */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gkypknwysbswbciptqpu.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_qwWNhOsY1iskUWTkM71muA_3YXtSI8A';
const PROJECTS_CACHE_MS = 15 * 1000;
let projectsCache = { at: 0, data: null };

function fromSupabaseRow(r) {
  const p = { id: r.id, title: r.title, category: r.category, published: r.published, order: r.sort_order, year: r.year };
  const optional = { subtitle: r.subtitle, client: r.client, director: r.director, description: r.description, video: r.video, preview: r.preview, videoMobile: r.video_mobile, poster: r.poster, youtube: r.youtube };
  for (const [k, v] of Object.entries(optional)) if (v !== null && v !== undefined && v !== '') p[k] = v;
  return p;
}

async function publicProjects() {
  const now = Date.now();
  if (projectsCache.data && now - projectsCache.at < PROJECTS_CACHE_MS) return projectsCache.data;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=*&published=eq.true&order=sort_order.asc`, {
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Supabase respondeu ${res.status}`);
    const data = (await res.json()).map(fromSupabaseRow).sort(byOrder);
    projectsCache = { at: now, data };
    return data;
  } catch (err) {
    console.error('[projetos] Supabase indisponível, usando JSON local:', err.message);
    return projectsCache.data || (await readJSON(PROJECTS_FILE, [])).filter((p) => p.published !== false).sort(byOrder);
  }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  // GET /api/health
  if (parts[1] === 'health') return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });

  // GET /api/projects  |  /api/projects/:id
  if (parts[1] === 'projects' && method === 'GET') {
    const projects = await publicProjects();
    if (parts[2]) {
      const project = projects.find((p) => p.id === parts[2]);
      if (!project) throw new HttpError(404, 'Projeto não encontrado.');
      return sendJSON(res, 200, project);
    }
    const category = url.searchParams.get('category');
    return sendJSON(res, 200, category ? projects.filter((p) => p.category === category) : projects);
  }

  // GET /api/categories
  if (parts[1] === 'categories' && method === 'GET') return sendJSON(res, 200, CATEGORIES);

  // POST /api/contact
  if (parts[1] === 'contact' && method === 'POST') {
    const body = await readJSONBody(req);
    if (body.website) return sendJSON(res, 200, { ok: true }); // honeypot anti-spam
    const data = validateContact(body);
    rateLimit(clientIp(req));
    const entry = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString(), ip: clientIp(req) };
    await mutate(CONTACT_MESSAGES_FILE, [], (list) => {
      list.unshift(entry);
      if (list.length > MAX_STORED_MESSAGES) list.length = MAX_STORED_MESSAGES; // evita encher o disco
    });
    console.log(`[contato] mensagem recebida — ${entry.service || 'geral'}`); // sem dados pessoais no log
    return sendJSON(res, 201, { ok: true, message: 'Mensagem recebida! Retornaremos em breve.' });
  }

  // POST /api/lgpd-request  (direitos do titular)
  if (parts[1] === 'lgpd-request' && method === 'POST') {
    const body = await readJSONBody(req);
    if (body.website) return sendJSON(res, 200, { ok: true, protocol: 'LGPD-0000-000000' }); // honeypot
    const data = validateLgpdRequest(body);
    rateLimit(clientIp(req));
    const now = new Date();
    const protocol = `LGPD-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const entry = { id: crypto.randomUUID(), protocol, ...data, status: 'recebido', createdAt: now.toISOString() };
    await mutate(LGPD_REQUESTS_FILE, [], (list) => {
      list.unshift(entry);
      if (list.length > MAX_STORED_MESSAGES) list.length = MAX_STORED_MESSAGES;
    });
    console.log(`[lgpd] pedido recebido — ${protocol}`); // sem dados pessoais no log
    return sendJSON(res, 201, { ok: true, protocol });
  }

  // ---------- Admin ----------
  if (parts[1] === 'admin') {
    if (!LEGACY_ADMIN) throw new HttpError(404, 'Rota não encontrada.');
    const resource = parts[2];
    const id = parts[3];

    // POST /api/admin/login  { username, password }  → { token, user }
    if (resource === 'login' && method === 'POST') {
      const ip = clientIp(req);
      if (recentLoginFails(ip).length >= 10) {
        throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
      }
      const body = await readJSONBody(req);
      const username = str(body.username, 64).toLowerCase();
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const userKey = `user:${username}`;
      if (recentFails(userKey).length >= 30) {
        throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
      }
      const users = await readJSON(USERS_FILE, []);
      const user = users.find((u) => u.username === username);
      const ok = user ? await checkPassword(user, password) : (await hashPassword(password), false);
      if (!ok) {
        recentLoginFails(ip).push(Date.now());
        recentFails(userKey).push(Date.now());
        throw new HttpError(401, 'Usuário ou senha incorretos.');
      }
      loginFails.delete(`ip:${ip}`);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value); // descarta a mais antiga
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      sessions.set(token, { userId: user.id, username: user.username, expires: now + SESSION_TTL_MS, created: now });
      console.log(`[login] ${user.username}`);
      return sendJSON(res, 200, { ok: true, token, user: publicUser(user) });
    }

    const session = requireAdmin(req);

    if (resource === 'logout' && method === 'POST') {
      sessions.delete(session.token);
      return sendJSON(res, 200, { ok: true });
    }

    if (resource === 'me' && method === 'GET') {
      return sendJSON(res, 200, { id: session.userId, username: session.username });
    }

    // POST /api/admin/password  { current, password }  → troca a própria senha
    if (resource === 'password' && method === 'POST') {
      const body = await readJSONBody(req);
      validateNewPassword(body.password);
      const failKey = `pwd:${session.userId}`;
      if (recentFails(failKey).length >= 5) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      const { salt, hash } = await hashPassword(body.password);
      const users = await readJSON(USERS_FILE, []);
      const me = users.find((u) => u.id === session.userId);
      if (!me || !(await checkPassword(me, String(body.current || '').slice(0, 200)))) {
        recentFails(failKey).push(Date.now());
        throw new HttpError(400, 'A senha atual está incorreta.');
      }
      await mutate(USERS_FILE, [], (list) => {
        const u = list.find((x) => x.id === session.userId);
        if (!u) throw new HttpError(404, 'Usuário não encontrado.');
        Object.assign(u, { salt, hash, updatedAt: new Date().toISOString() });
      });
      // derruba as outras sessões desse usuário
      for (const [t, s] of sessions) if (s.userId === session.userId && t !== session.token) sessions.delete(t);
      return sendJSON(res, 200, { ok: true });
    }

    if (resource === 'users') {
      if (method === 'GET') {
        const users = await readJSON(USERS_FILE, []);
        return sendJSON(res, 200, users.map(publicUser));
      }

      if (method === 'POST' && !id) {
        const body = await readJSONBody(req);
        const username = str(body.username, 64).toLowerCase();
        if (!USERNAME_RE.test(username)) {
          throw new HttpError(400, 'Usuário inválido: use de 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.');
        }
        validateNewPassword(body.password);
        const { salt, hash } = await hashPassword(body.password);
        const created = await mutate(USERS_FILE, [], (list) => {
          if (list.some((u) => u.username === username)) throw new HttpError(409, 'Já existe um usuário com esse nome.');
          const user = { id: crypto.randomUUID(), username, salt, hash, createdAt: new Date().toISOString(), createdBy: session.username };
          list.push(user);
          return user;
        });
        console.log(`[usuários] ${session.username} criou ${created.username}`);
        return sendJSON(res, 201, publicUser(created));
      }

      if (method === 'DELETE' && id) {
        if (id === session.userId) throw new HttpError(400, 'Você não pode excluir o próprio usuário.');
        const removed = await mutate(USERS_FILE, [], (list) => {
          const i = list.findIndex((u) => u.id === id);
          if (i < 0) throw new HttpError(404, 'Usuário não encontrado.');
          if (list.length <= 1) throw new HttpError(400, 'O painel precisa ter pelo menos um usuário.');
          return list.splice(i, 1)[0];
        });
        for (const [t, s] of sessions) if (s.userId === id) sessions.delete(t);
        console.log(`[usuários] ${session.username} excluiu ${removed.username}`);
        return sendJSON(res, 200, { ok: true });
      }
    }

    if (resource === 'contacts' && method === 'GET') {
      return sendJSON(res, 200, await readJSON(CONTACT_MESSAGES_FILE, []));
    }

    if (resource === 'lgpd-requests' && method === 'GET') {
      return sendJSON(res, 200, await readJSON(LGPD_REQUESTS_FILE, []));
    }

    if (resource === 'projects') {
      if (method === 'GET') return sendJSON(res, 200, (await readJSON(PROJECTS_FILE, [])).sort(byOrder));

      if (method === 'POST' && !id) {
        const body = await readJSONBody(req);
        const created = await mutate(PROJECTS_FILE, [], (list) => {
          const project = sanitizeProject(body, { order: list.length + 1 });
          let base = slugify(project.title) || 'projeto';
          if (body.id !== undefined && typeof body.id !== 'string') throw new HttpError(400, 'Identificador de projeto inválido.');
          let slug = body.id || base;
          if (body.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.id)) throw new HttpError(400, 'Identificador de projeto inválido.');
          if (body.id && list.some((p) => p.id === slug)) throw new HttpError(409, 'Já existe um projeto com este identificador.');
          for (let n = 2; !body.id && list.some((p) => p.id === slug); n++) slug = `${base}-${n}`;
          project.id = slug;
          project.createdAt = new Date().toISOString();
          list.push(project);
          return project;
        });
        return sendJSON(res, 201, created);
      }

      if (method === 'PUT' && id) {
        const body = await readJSONBody(req);
        const updated = await mutate(PROJECTS_FILE, [], (list) => {
          const i = list.findIndex((p) => p.id === id);
          if (i < 0) throw new HttpError(404, 'Projeto não encontrado.');
          list[i] = { ...sanitizeProject(body, list[i]), id, updatedAt: new Date().toISOString() };
          return list[i];
        });
        return sendJSON(res, 200, updated);
      }

      if (method === 'DELETE' && id) {
        await mutate(PROJECTS_FILE, [], (list) => {
          const i = list.findIndex((p) => p.id === id);
          if (i < 0) throw new HttpError(404, 'Projeto não encontrado.');
          list.splice(i, 1);
        });
        return sendJSON(res, 200, { ok: true });
      }
    }

    if (resource === 'upload' && method === 'POST') return handleUpload(req, res, url);
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

// Upload com corpo bruto (sem multipart): cada arquivo fica na pasta do projeto.
async function handleUpload(req, res, url) {
  const original = url.searchParams.get('name') || 'arquivo';
  const projectId = url.searchParams.get('project') || '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) throw new HttpError(400, 'Informe um identificador de projeto válido.');
  const ext = path.extname(original).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) throw new HttpError(415, `Formato não suportado (${ext || 'sem extensão'}).`);
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Arquivo maior que 1 GB.');

  const projectDir = path.join(UPLOAD_DIR, projectId);
  await fsp.mkdir(projectDir, { recursive: true });
  const name = `${slugify(path.basename(original, ext)) || 'arquivo'}-${Date.now().toString(36)}${ext}`;
  const dest = path.join(projectDir, name);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(dest, () => reject(err));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        req.unpipe(out);
        req.destroy();
        fail(new HttpError(413, 'Arquivo maior que 1 GB.'));
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', resolve);
    req.pipe(out);
  });

  console.log(`[upload] ${name}`);
  return sendJSON(res, 201, { ok: true, url: `/media/portfolio/${projectId}/${name}` });
}

/* ------------------------------------------------------------------ */
/* Arquivos estáticos (com Range para vídeo)                           */
/* ------------------------------------------------------------------ */

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'URL inválida.');
  }
  if (pathname === '/robots.txt') {
    const body = `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;
    res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (pathname === '/sitemap.xml') {
    const pages = ['/', '/legal/politica-de-privacidade.html', '/legal/termos-de-servico.html', '/legal/aviso-de-cookies.html', '/legal/lgpd-direitos-do-titular.html'];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}
</urlset>
`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  const isPublicContactInfo = pathname === '/data/contacts.json';
  if (pathname === '/data' || (pathname.startsWith('/data/') && !isPublicContactInfo)) {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
  let file = isPublicContactInfo ? CONTACT_INFO_FILE : path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!isPublicContactInfo && file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    throw new HttpError(403, 'Acesso negado.');
  }

  let stat;
  try {
    stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fsp.stat(file);
    }
  } catch {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }

  // A página inicial recebe o endereço real do site nas tags canonical/Open Graph.
  if (file === path.join(PUBLIC_DIR, 'index.html')) {
    const html = (await fsp.readFile(file, 'utf8')).split('__SITE_URL__').join(SITE_URL);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : html);
  }

  const ext = path.extname(file).toLowerCase();
  const isMedia = /^(video|image|font)\//.test(MIME[ext] || '');
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': isMedia ? 'public, max-age=604800' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start;
    let end;
    if (m && m[1] !== '') {
      start = Number(m[1]);
      end = m[2] !== '' ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    } else if (m && m[2] !== '') {
      start = Math.max(stat.size - Number(m[2]), 0); // sufixo: últimos N bytes
      end = stat.size - 1;
    }
    if (start === undefined || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(req, res);
  // Base fixa: o cabeçalho Host é controlado pelo cliente e um valor malformado derrubava o processo.
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': MIME['.txt'] });
    return res.end('Requisição inválida.');
  }
  if (FORCE_HTTPS && TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim() === 'http') {
    res.writeHead(301, { Location: `${SITE_URL.replace(/^http:/, 'https:')}${req.url}` });
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.destroy();
    if (url.pathname.startsWith('/api/') || status !== 404) {
      return sendJSON(res, status, { ok: false, error: status === 500 ? 'Erro interno.' : err.message, details: err.details });
    }
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end('<!doctype html><meta charset="utf-8"><title>404</title><body style="background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>Página não encontrada · <a style="color:#fff" href="/">voltar</a></p>');
  }
});

// Limites contra conexões lentas / cabeçalhos gigantes (uploads grandes continuam permitidos).
server.headersTimeout = 20 * 1000;
server.keepAliveTimeout = 10 * 1000;
server.maxHeadersCount = 50;

// Uma falha inesperada numa requisição nunca deve derrubar o servidor.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

async function start() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONTACT_MESSAGES_FILE)) await writeJSON(CONTACT_MESSAGES_FILE, []);
  if (!fs.existsSync(PROJECTS_FILE)) await writeJSON(PROJECTS_FILE, []);
  if (!fs.existsSync(LGPD_REQUESTS_FILE)) await writeJSON(LGPD_REQUESTS_FILE, []);
  if (LEGACY_ADMIN) await ensureFirstUser();

  server.listen(PORT, () => {
    console.log(`\n  Have Studio Criativo rodando em  http://localhost:${PORT}`);
    console.log(`  Painel do portfólio:       http://localhost:${PORT}/admin.html\n`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
