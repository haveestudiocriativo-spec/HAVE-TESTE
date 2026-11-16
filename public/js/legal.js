'use strict';

/* Scripts das páginas legais: formulário LGPD, preferências de cookies e impressão. */
(() => {
  const CONSENT_KEY = 'have-consent';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Preferências de cookies ---------- */
  function readConsent() {
    try {
      const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (v && typeof v.thirdParty === 'boolean' && Date.now() - v.ts < 365 * 24 * 3600 * 1000) return v;
    } catch { /* sem storage */ }
    return null;
  }
  function writeConsent(thirdParty) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, thirdParty, ts: Date.now() })); } catch { /* sem storage */ }
  }
  function renderState() {
    const el = $('#consentState');
    if (!el) return;
    const c = readConsent();
    el.textContent = !c ? 'nenhuma escolha feita ainda' : c.thirdParty ? 'cookies de terceiros aceitos' : 'cookies de terceiros recusados';
  }
  $$('[data-consent-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      writeConsent(btn.dataset.consentAction === 'accept');
      renderState();
    });
  });
  renderState();

  /* ---------- Impressão ---------- */
  $$('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));

  /* ---------- Formulário LGPD ---------- */
  const form = $('#lgpdForm');
  if (!form) return;
  const status = $('#lgpdStatus');
  const submit = $('#lgpdSubmit');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const setError = (name, msg) => {
    const el = $(`[data-error-for="${name}"]`, form);
    if (el) el.textContent = msg || '';
  };
  const showStatus = (kind, msg) => {
    status.className = `form-status ${kind === 'ok' ? 'is-ok' : 'is-err'}`;
    status.textContent = msg;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ['name', 'email', 'relation', 'requests', 'details', 'declaration'].forEach((n) => setError(n, ''));
    status.className = 'form-status';

    const fd = new FormData(form);
    const data = {
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      relation: String(fd.get('relation') || ''),
      requests: fd.getAll('requests'),
      details: String(fd.get('details') || '').trim(),
      declaration: fd.get('declaration') === 'yes',
      website: String(fd.get('website') || ''),
    };

    let bad = false;
    if (data.name.length < 2) { setError('name', 'Informe seu nome.'); bad = true; }
    if (!EMAIL_RE.test(data.email)) { setError('email', 'Informe um e-mail válido.'); bad = true; }
    if (!data.relation) { setError('relation', 'Selecione uma opção.'); bad = true; }
    if (!data.requests.length) { setError('requests', 'Marque pelo menos uma opção.'); bad = true; }
    if (data.details.length < 10) { setError('details', 'Descreva o seu pedido (mín. 10 caracteres).'); bad = true; }
    if (!data.declaration) { setError('declaration', 'É necessário confirmar a declaração.'); bad = true; }
    if (bad) return;

    submit.disabled = true;
    try {
      const res = await fetch('/api/lgpd-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.details) Object.entries(body.details).forEach(([k, v]) => setError(k, v));
        throw new Error(body.error || 'Não foi possível enviar agora.');
      }
      form.reset();
      showStatus('ok', `Pedido recebido. Protocolo: ${body.protocol}. Responderemos por e-mail em até 15 dias. Guarde este número.`);
    } catch (err) {
      showStatus('err', `${err.message} Se o problema continuar, escreva para haveestudiocriativo@gmail.com.`);
    } finally {
      submit.disabled = false;
    }
  });
})();
