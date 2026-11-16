/* Painel do portfólio — Have Studio Criativo (Supabase Auth + Postgres + Storage) */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Supabase ---------- */

  const { url: SUPABASE_URL, key: SUPABASE_KEY } = window.HAVE_SUPABASE || {};
  const BUCKET = 'portfolio';
  const sessionStore = (() => {
    try { sessionStorage.setItem('__t', '1'); sessionStorage.removeItem('__t'); return sessionStorage; } catch { return undefined; }
  })();
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: sessionStore },
  });

  let projects = [];
  let editingId = null;
  let draftProjectId = null;
  let me = null;

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function uploadProjectId() {
    if (editingId) return editingId;
    if (draftProjectId) return draftProjectId;
    const title = form.elements.title.value.trim();
    if (!title) throw new Error('Informe o título antes de enviar arquivos.');
    const base = slugify(title) || 'projeto';
    let id = base;
    for (let suffix = 2; projects.some((project) => project.id === id); suffix++) id = `${base}-${suffix}`;
    draftProjectId = id;
    return id;
  }

  /* ---------- Acesso a dados ---------- */

  // Converte a resposta { data, error } do supabase-js em valor ou exceção com mensagem em português.
  function unwrap({ data, error }) {
    if (!error) return data;
    if (error.status === 401 || error.code === 'PGRST301' || /jwt/i.test(error.message || '')) {
      logout();
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (error.code === '23505') throw new Error('Já existe um registro com esse identificador.');
    if (error.code === '23514') throw new Error('Algum campo é inválido (confira as URLs de mídia e os tamanhos).');
    if (error.code === '42501') throw new Error('Sem permissão para essa ação.');
    if (error.code === 'P0001') throw new Error(error.message);
    throw new Error('Não foi possível concluir a ação. Tente novamente.');
  }

  async function callAdminUsers(method, body) {
    const { data, error } = await sb.functions.invoke('admin-users', { method, body });
    if (error) {
      let msg = 'Não foi possível concluir a ação.';
      try { msg = (await error.context.json()).error || msg; } catch { /* sem corpo */ }
      throw new Error(msg);
    }
    return data;
  }

  const fromRow = (r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    category: r.category,
    client: r.client,
    director: r.director,
    year: r.year,
    description: r.description,
    video: r.video,
    preview: r.preview,
    videoMobile: r.video_mobile,
    poster: r.poster,
    youtube: r.youtube,
    published: r.published,
    order: r.sort_order,
  });

  // Mesmo filtro da coluna projects.youtube no banco.
  const YOUTUBE_RE = /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/\S+$/i;

  const blankToNull = (v) => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
  };

  function toRow(data) {
    return {
      title: String(data.title || '').trim(),
      subtitle: blankToNull(data.subtitle),
      category: data.category,
      client: blankToNull(data.client),
      director: blankToNull(data.director),
      year: Number.parseInt(data.year, 10) || null,
      description: blankToNull(data.description),
      video: String(data.video || '').trim(),
      preview: blankToNull(data.preview),
      video_mobile: blankToNull(data.videoMobile),
      poster: blankToNull(data.poster),
      youtube: blankToNull(data.youtube),
      published: Boolean(data.published),
      sort_order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
    };
  }

  const MIME_BY_EXT = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  };

  // Envia direto ao Storage (com progresso). A política do bucket só aceita administradores.
  async function upload(file, projectId, onProgress) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
    if (!MIME_BY_EXT[ext]) throw new Error(`Formato não suportado (${ext || 'sem extensão'}).`);
    const base = slugify(dot >= 0 ? file.name.slice(0, dot) : file.name) || 'arquivo';
    const path = `${projectId}/${base}-${Date.now().toString(36)}${ext}`;
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('Sessão expirada. Entre novamente.');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
      xhr.setRequestHeader('Authorization', `Bearer ${data.session.access_token}`);
      xhr.setRequestHeader('apikey', SUPABASE_KEY);
      xhr.setRequestHeader('Content-Type', MIME_BY_EXT[ext]);
      xhr.setRequestHeader('Cache-Control', 'max-age=604800');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status < 300) return resolve({ url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` });
        let msg = `Erro ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* resposta vazia */ }
        if (xhr.status === 413) msg = 'Arquivo maior que o limite do armazenamento.';
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error('Falha de conexão no envio.'));
      xhr.send(file);
    });
  }

  /* ---------- UI helpers ---------- */

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-error', Boolean(isError));
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-show'), 2800);
  }

  /* ---------- Login (e-mail + senha) ---------- */

  // abre o painel com uma sessão válida; só quem tem perfil de administrador entra
  async function enter() {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) throw new Error('Sem sessão.');
    const profile = unwrap(await sb.from('profiles').select('id, username').eq('id', user.id).maybeSingle());
    if (!profile) {
      await sb.auth.signOut();
      throw new Error('Esta conta não tem acesso ao painel.');
    }
    me = { id: profile.id, username: profile.username, email: user.email };
    $('#whoami').innerHTML = `Logado como <strong>${esc(me.username)}</strong>`;
    $('#login').hidden = true;
    $('#app').hidden = false;
    await Promise.all([loadProjects(), loadContacts(), loadUsers(), loadRequests()]);
  }

  async function login(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === 'user_banned') throw new Error('Seu cadastro ainda aguarda aprovação de um administrador.');
      throw new Error(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : 'E-mail ou senha incorretos.');
    }
    await enter();
  }

  function logout() {
    sb.auth.signOut().catch(() => {});
    me = null;
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginToken').value = '';
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    const data = new FormData(e.target);
    const btn = $('[type="submit"]', e.target);
    btn.disabled = true;
    try {
      await login(String(data.get('email') || '').trim().toLowerCase(), String(data.get('password') || ''));
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $('#logout').addEventListener('click', logout);

  /* ---------- Solicitar acesso (precisa de aprovação de outro administrador) ---------- */

  const requestForm = $('#requestForm');
  const loginForm = $('#loginForm');

  function showRequestForm(show) {
    requestForm.hidden = !show;
    loginForm.hidden = show;
    $('#requestMsg').textContent = '';
    $('#requestMsg').classList.remove('is-ok');
  }
  $('#showRequest').addEventListener('click', () => showRequestForm(true));
  $('#backToLogin').addEventListener('click', () => showRequestForm(false));

  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#requestMsg');
    msg.textContent = '';
    msg.style.color = '';
    const data = Object.fromEntries(new FormData(requestForm));
    if (data.password !== data.confirm) {
      msg.textContent = 'As senhas não conferem.';
      return;
    }
    const btn = $('[type="submit"]', requestForm);
    btn.disabled = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
        body: JSON.stringify({
          username: String(data.username).trim().toLowerCase(),
          email: String(data.email).trim().toLowerCase(),
          password: data.password,
          website: data.website,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Não foi possível enviar a solicitação.');
      requestForm.reset();
      msg.style.color = 'var(--ok, #4ade80)';
      msg.textContent = json.message || 'Solicitação enviada. Aguarde a aprovação de um administrador.';
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Login: mostrar/ocultar senha ---------- */

  const tokenInput = $('#loginToken');
  const toggleToken = $('#toggleToken');

  function setTokenVisible(visible) {
    tokenInput.type = visible ? 'text' : 'password';
    toggleToken.classList.toggle('is-open', visible);
    toggleToken.setAttribute('aria-pressed', String(visible));
    toggleToken.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  }

  toggleToken.addEventListener('click', () => {
    setTokenVisible(tokenInput.type === 'password');
  });
  toggleToken.addEventListener('mouseup', (e) => e.preventDefault()); // evita perder foco no clique

  /* ---------- Abas ---------- */

  $$('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      $$('.view').forEach((v) => (v.hidden = v.id !== `view-${tab.dataset.tab}`));
    }),
  );

  /* ---------- Projetos ---------- */

  async function loadProjects() {
    projects = unwrap(await sb.from('projects').select('*').order('sort_order', { ascending: true })).map(fromRow);
    renderProjects();
  }

  function renderProjects() {
    const list = $('#projectList');
    if (!projects.length) {
      list.innerHTML = '<div class="empty">Nenhum projeto ainda. Clique em “+ Novo projeto” para adicionar o primeiro vídeo.</div>';
      return;
    }
    list.innerHTML = projects
      .map(
        (p, i) => `
      <article class="item" data-id="${esc(p.id)}">
        <div class="move">
          <button type="button" data-move="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" data-move="1" aria-label="Descer" ${i === projects.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="item__thumb">${
          p.poster
            ? `<img src="${esc(p.poster)}" alt="" loading="lazy">`
            : `<video src="${esc(p.video)}#t=1" muted preload="metadata"></video>`
        }</div>
        <div>
          <div class="item__title">${esc(p.title)}</div>
          <div class="item__sub">${esc(p.subtitle || '')}</div>
          <div class="item__sub">
            <span class="pill">${esc(p.category)}</span>
            ${p.published === false ? '<span class="pill pill--off">Oculto</span>' : ''}
            ${p.year ? `<span class="pill">${esc(p.year)}</span>` : ''}
          </div>
        </div>
        <div class="item__actions">
          <button class="btn btn--ghost" type="button" data-edit>Editar</button>
          <button class="btn btn--ghost btn--danger" type="button" data-delete>Excluir</button>
        </div>
      </article>`,
      )
      .join('');
  }

  $('#projectList').addEventListener('click', async (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const project = projects.find((p) => p.id === item.dataset.id);
    if (!project) return;

    if (e.target.closest('[data-edit]')) return openEditor(project);

    if (e.target.closest('[data-delete]')) {
      if (!confirm(`Excluir “${project.title}” do portfólio? Os arquivos de vídeo continuam no armazenamento.`)) return;
      try {
        unwrap(await sb.from('projects').delete().eq('id', project.id));
        toast('Projeto excluído.');
        await loadProjects();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    const move = e.target.closest('[data-move]');
    if (move) {
      const from = projects.indexOf(project);
      const to = from + Number(move.dataset.move);
      if (to < 0 || to >= projects.length) return;
      const reordered = [...projects];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
      try {
        unwrap(await sb.rpc('reorder_projects', { ids: reordered.map((p) => p.id) }));
        await loadProjects();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  /* ---------- Editor ---------- */

  const editor = $('#editor');
  const form = $('#projectForm');
  const preview = $('#preview');

  function setPreview(src) {
    $('#previewEmpty').hidden = Boolean(src);
    if (src) {
      preview.src = src;
      preview.play().catch(() => {});
    } else {
      preview.removeAttribute('src');
      preview.load();
    }
  }

  function openEditor(project) {
    editingId = project ? project.id : null;
    draftProjectId = null;
    $('#editorTitle').textContent = project ? 'Editar projeto' : 'Novo projeto';
    $('#editorError').textContent = '';
    form.reset();
    const p = project || { order: projects.length + 1, published: true, year: new Date().getFullYear() };
    for (const el of form.elements) {
      if (!el.name || el.type === 'file') continue;
      if (el.type === 'checkbox') el.checked = p[el.name] !== false;
      else el.value = p[el.name] ?? '';
    }
    setPreview(p.video || '');
    editor.showModal();
  }

  function closeEditor() {
    setPreview('');
    editor.close();
  }

  $('#newProject').addEventListener('click', () => openEditor(null));
  $$('[data-cancel]', editor).forEach((b) => b.addEventListener('click', closeEditor));
  editor.addEventListener('cancel', () => setPreview(''));
  form.elements.video.addEventListener('change', (e) => setPreview(e.target.value.trim()));

  // Upload de arquivos
  $$('[data-upload]', form).forEach((input) =>
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      let projectId;
      try {
        projectId = uploadProjectId();
      } catch (err) {
        $('#editorError').textContent = err.message;
        input.value = '';
        return;
      }
      const target = form.elements[input.dataset.upload];
      const bar = $('#uploadProgress');
      const save = $('#saveBtn');
      bar.hidden = false;
      save.disabled = true;
      $('#editorError').textContent = '';
      const setP = (p) => {
        $('span', bar).style.width = `${Math.round(p * 100)}%`;
        $('em', bar).textContent = `Enviando ${file.name} — ${Math.round(p * 100)}%`;
      };
      setP(0);
      try {
        const { url } = await upload(file, projectId, setP);
        target.value = url;
        if (input.dataset.upload === 'video') setPreview(url);
        toast('Arquivo enviado.');
      } catch (err) {
        $('#editorError').textContent = err.message;
      } finally {
        bar.hidden = true;
        save.disabled = false;
        input.value = '';
      }
    }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.published = form.elements.published.checked;
    const save = $('#saveBtn');
    save.disabled = true;
    $('#editorError').textContent = '';
    try {
      const row = toRow(data);
      if (!row.title) throw new Error('Informe o título do projeto.');
      if (!row.video) throw new Error('Informe o vídeo do projeto.');
      if (row.youtube && !YOUTUBE_RE.test(row.youtube)) {
        throw new Error('Link do YouTube inválido. Use um endereço https://youtu.be/… ou https://www.youtube.com/watch?v=…');
      }
      if (editingId) {
        unwrap(await sb.from('projects').update(row).eq('id', editingId));
      } else {
        let id = draftProjectId;
        if (!id) {
          const base = slugify(row.title) || 'projeto';
          id = base;
          for (let n = 2; projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
        }
        unwrap(await sb.from('projects').insert({ ...row, id }));
      }
      const wasEditing = Boolean(editingId);
      closeEditor();
      toast(wasEditing ? 'Projeto atualizado.' : 'Projeto criado.');
      await loadProjects();
    } catch (err) {
      $('#editorError').textContent = err.message;
    } finally {
      save.disabled = false;
    }
  });

  /* ---------- Mensagens ---------- */

  async function loadContacts() {
    const contacts = unwrap(await sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(500));
    $('#contactCount').textContent = contacts.length || '';
    const list = $('#contactList');
    if (!contacts.length) {
      list.innerHTML = '<div class="empty">Nenhuma mensagem recebida ainda.</div>';
      return;
    }
    const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    list.innerHTML = contacts
      .map(
        (c) => `
      <article class="msg">
        <div class="msg__head">
          <span class="msg__name">${esc(c.name)}</span>
          <a class="msg__meta" href="mailto:${esc(c.email)}">${esc(c.email)}</a>
          ${c.phone ? `<span class="msg__meta">${esc(c.phone)}</span>` : ''}
          ${c.company ? `<span class="msg__meta">${esc(c.company)}</span>` : ''}
          ${c.service ? `<span class="pill">${esc(c.service)}</span>` : ''}
          <span class="msg__meta">${esc(fmt.format(new Date(c.created_at)))}</span>
        </div>
        <p class="msg__body">${esc(c.message)}</p>
      </article>`,
      )
      .join('');
  }

  /* ---------- Usuários ---------- */

  const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
  const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  let users = [];

  async function loadUsers() {
    users = unwrap(await sb.from('profiles').select('id, username, created_at, created_by').order('created_at', { ascending: true }));
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    const list = $('#userList');
    list.innerHTML = users
      .map((u) => {
        const isMe = me && u.id === me.id;
        const by = u.created_by ? nameById.get(u.created_by) : '';
        const meta = [`Criado em ${dateFmt.format(new Date(u.created_at))}`, by ? `por ${by}` : ''].filter(Boolean).join(' ');
        return `
      <article class="user" data-id="${esc(u.id)}">
        <span class="user__avatar" aria-hidden="true">${esc(u.username.charAt(0))}</span>
        <div class="user__info">
          <div class="user__name">${esc(u.username)} ${isMe ? '<span class="pill pill--me">Você</span>' : ''}</div>
          <div class="user__meta">${esc(meta)}</div>
        </div>
        <button class="btn btn--remove" type="button" data-delete-user ${
          isMe ? 'disabled title="Você não pode remover o próprio usuário. Peça para outro usuário fazer isso."' : `aria-label="Remover o usuário ${esc(u.username)}"`
        }>${TRASH_ICON}Remover</button>
      </article>`;
      })
      .join('');
  }

  $('#userList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-user]');
    if (!btn || btn.disabled) return;
    const u = users.find((x) => x.id === btn.closest('.user').dataset.id);
    if (!u || !confirm(`Remover o usuário “${u.username}”? Ele não vai mais conseguir entrar no painel.`)) return;
    try {
      await callAdminUsers('DELETE', { id: u.id });
      toast(`Usuário ${u.username} removido.`);
      await loadUsers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------- Solicitações de acesso pendentes ---------- */

  let requests = [];

  async function loadRequests() {
    requests = unwrap(await sb.from('admin_requests').select('id, username, email, created_at').eq('status', 'pending').order('created_at', { ascending: true }));
    $('#requestCount').textContent = requests.length || '';
    $('#requestsBox').hidden = !requests.length;
    const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    $('#requestList').innerHTML = requests
      .map(
        (r) => `
      <article class="user request" data-id="${esc(r.id)}">
        <span class="user__avatar" aria-hidden="true">${esc(r.username.charAt(0))}</span>
        <div class="user__info">
          <div class="user__name">${esc(r.username)} <span class="pill">Pendente</span></div>
          <div class="user__meta">${esc(r.email)} · pediu em ${esc(fmt.format(new Date(r.created_at)))}</div>
        </div>
        <div class="request__actions">
          <button class="btn btn--primary" type="button" data-approve>Aprovar</button>
          <button class="btn btn--ghost btn--danger" type="button" data-reject>Recusar</button>
        </div>
      </article>`,
      )
      .join('');
  }

  $('#requestList').addEventListener('click', async (e) => {
    const approve = e.target.closest('[data-approve]');
    const reject = e.target.closest('[data-reject]');
    if (!approve && !reject) return;
    const card = e.target.closest('.request');
    const r = requests.find((x) => x.id === card.dataset.id);
    if (!r) return;
    const question = approve
      ? `Aprovar “${r.username}” (${r.email})? Essa pessoa passará a ter acesso total ao painel.`
      : `Recusar a solicitação de “${r.username}”? O cadastro será apagado.`;
    if (!confirm(question)) return;
    $$('button', card).forEach((b) => (b.disabled = true));
    try {
      await callAdminUsers('POST', { action: approve ? 'approve' : 'reject', id: r.id });
      toast(approve ? `${r.username} aprovado.` : 'Solicitação recusada.');
      await Promise.all([loadRequests(), loadUsers()]);
    } catch (err) {
      toast(err.message, true);
      await loadRequests();
    }
  });

  $('#newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.error', f);
    err.textContent = '';
    const data = Object.fromEntries(new FormData(f));
    if (data.password !== data.confirm) {
      err.textContent = 'As senhas não conferem.';
      return;
    }
    const btn = $('[type="submit"]', f);
    btn.disabled = true;
    try {
      const u = await callAdminUsers('POST', {
        username: data.username.trim().toLowerCase(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      });
      f.reset();
      toast(`Usuário ${u.username} cadastrado.`);
      await loadUsers();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.error', f);
    err.textContent = '';
    const data = Object.fromEntries(new FormData(f));
    if (data.password !== data.confirm) {
      err.textContent = 'As senhas novas não conferem.';
      return;
    }
    if (data.password.length < 8 || data.password.length > 200) {
      err.textContent = 'A nova senha precisa ter de 8 a 200 caracteres.';
      return;
    }
    const btn = $('[type="submit"]', f);
    btn.disabled = true;
    try {
      // confirma a senha atual antes de trocar
      const check = await sb.auth.signInWithPassword({ email: me.email, password: data.current });
      if (check.error) throw new Error('A senha atual está incorreta.');
      const { error } = await sb.auth.updateUser({ password: data.password });
      if (error) throw new Error(error.message?.includes('different') ? 'A nova senha precisa ser diferente da atual.' : 'Não foi possível trocar a senha.');
      await sb.auth.signOut({ scope: 'others' }); // derruba as outras sessões
      f.reset();
      toast('Senha alterada.');
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Início ---------- */

  sb.auth.getSession().then(({ data }) => {
    if (data.session) enter().catch(logout);
  });
})();
