'use strict';

/*
 * Banner de cookies e bloqueio prévio do Google Maps.
 * O mapa só é carregado depois do aceite; sem aceite, o visitante vê um link para o endereço.
 */
(() => {
  const CONSENT_KEY = 'have-consent';
  const MAX_AGE_MS = 365 * 24 * 3600 * 1000;

  function readConsent() {
    try {
      const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (v && typeof v.thirdParty === 'boolean' && Date.now() - v.ts < MAX_AGE_MS) return v;
    } catch { /* sem storage */ }
    return null;
  }
  function writeConsent(thirdParty) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, thirdParty, ts: Date.now() })); } catch { /* sem storage */ }
  }

  const banner = document.getElementById('consent');
  const map = document.getElementById('contactMap');
  const placeholder = document.getElementById('mapConsent');

  // Carrega (ou não) o mapa conforme a escolha atual. Chamada também pelo site.js
  // quando os contatos oficiais terminam de carregar.
  function applyMap() {
    if (!map) return;
    const c = readConsent();
    const url = map.dataset.embed || '';
    if (c && c.thirdParty && url) {
      if (map.getAttribute('src') !== url) map.src = url;
      map.hidden = false;
      if (placeholder) placeholder.hidden = true;
    } else {
      map.removeAttribute('src');
      map.hidden = true;
      if (placeholder) placeholder.hidden = false;
    }
  }
  window.haveApplyMap = applyMap;

  function choose(thirdParty) {
    writeConsent(thirdParty);
    if (banner) banner.hidden = true;
    applyMap();
  }

  document.querySelectorAll('[data-consent-action]').forEach((btn) => {
    btn.addEventListener('click', () => choose(btn.dataset.consentAction === 'accept'));
  });
  document.querySelectorAll('[data-open-consent]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (banner) { banner.hidden = false; banner.querySelector('button')?.focus(); }
    });
  });

  if (banner) banner.hidden = !!readConsent();
  applyMap();
})();
