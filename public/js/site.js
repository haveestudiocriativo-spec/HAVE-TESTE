/* =========================================================
  Have Studio Criativo — front-end
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Configuração ---------- */
  const SLIDE_DURATION = 9000; // ms que cada vídeo fica em tela antes de avançar
  const TRANSITION_MS = 1800; // precisa bater com a animação .enter-* (softFade) no CSS
  const INTRO_ONCE_PER_SESSION = false;

  const isMobile = matchMedia('(max-width: 768px)').matches;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const body = document.body;

  const state = {
    all: [],
    list: [],
    index: 0,
    busy: false,
    started: false,
    elapsed: 0,
    lastTick: 0,
    lastNav: 0,
  };

  /* =========================================================
     INTRO
     ========================================================= */
  function runIntro() {
    return new Promise((resolve) => {
      const intro = $('#intro');
      const video = $('#introVideo');
      const skip = $('#introSkip');
      const startBtn = $('#introStart');
      const bar = $('#introProgress');
      const params = new URLSearchParams(location.search);

      let seen = false;
      try { seen = sessionStorage.getItem('have-intro') === '1'; } catch { /* sem storage */ }
      const shouldSkip = !params.has('intro') && (reduceMotion || (INTRO_ONCE_PER_SESSION && seen));

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { sessionStorage.setItem('have-intro', '1'); } catch { /* sem storage */ }
        document.removeEventListener('keydown', onKey);
        body.classList.remove('is-intro');
        body.classList.add('intro-done');
        resolve();
        setTimeout(() => {
          video.pause();
          video.removeAttribute('src');
          video.load();
          intro.remove();
        }, 1300);
      };

      const onKey = (e) => {
        if (['Escape', 'Enter', ' '].includes(e.key)) {
          e.preventDefault();
          finish();
        }
      };

      if (shouldSkip) {
        finish();
        return;
      }

      document.addEventListener('keydown', onKey);
      skip.addEventListener('click', finish);

      video.src = isMobile ? video.dataset.srcMobile : video.dataset.srcDesktop;

      const tick = () => {
        if (finished) return;
        if (video.duration) {
          const p = video.currentTime / video.duration;
          bar.style.transform = `scaleX(${p})`;
          if (video.duration - video.currentTime < 0.3) return finish();
        }
        requestAnimationFrame(tick);
      };

      video.addEventListener('ended', finish);
      video.addEventListener('error', finish);

      let ticking = false;
      video.addEventListener('playing', () => {
        startBtn.hidden = true;
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(tick);
        }
      });

      const play = () => video.play();

      play().catch(() => {
        startBtn.hidden = false;
        startBtn.addEventListener('click', () => {
          startBtn.hidden = true;
          play().catch(finish);
        }, { once: true });
      });
    });
  }

  /* =========================================================
     DADOS
     ========================================================= */
  async function loadProjects() {
    try {
      const res = await fetch('/api/projects', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('Não foi possível carregar os projetos:', err);
      return [];
    }
  }

  function contactValue(contacts, path) {
    return path.split('.').reduce((value, key) => value?.[key], contacts);
  }

  async function loadContactInfo() {
    try {
      const res = await fetch('/data/contacts.json', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.statusText);
      const contacts = await res.json();

      $$('[data-contact-text]').forEach((el) => {
        const value = contactValue(contacts, el.dataset.contactText);
        if (typeof value === 'string') el.textContent = value;
      });
      $$('[data-contact-href]').forEach((el) => {
        const value = contactValue(contacts, el.dataset.contactHref);
        if (typeof value === 'string') el.href = value;
      });

      const map = $('#contactMap');
      const embedUrl = contactValue(contacts, map?.dataset.contactSrc || '');
      // O mapa do Google só é carregado com o aceite de cookies de terceiros (cookies.js).
      if (map && typeof embedUrl === 'string') {
        map.dataset.embed = embedUrl;
        if (window.haveApplyMap) window.haveApplyMap();
      }
    } catch (err) {
      console.warn('Não foi possível carregar os contatos oficiais:', err);
    }
  }

  // Fundo: só o trecho curto (preview). O filme completo nunca é baixado aqui.
  const bgSrcFor = (p) => p.preview || (isMobile && p.videoMobile ? p.videoMobile : p.video);
  // Player: filme completo, carregado apenas quando o visitante clica no play.
  const fullSrcFor = (p) => (isMobile && p.videoMobile ? p.videoMobile : p.video);
  // Link do filme no YouTube: só segue https do YouTube (mesmo filtro do servidor e do banco).
  const YOUTUBE_RE = /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/\S+$/i;
  const youtubeFor = (p) => (typeof p?.youtube === 'string' && YOUTUBE_RE.test(p.youtube) ? p.youtube : '');

  /* =========================================================
     REEL
     ========================================================= */
  const slidesEl = $('#slides');
  const dotsEl = $('#dots');
  const info = $('#info');

  function render() {
    slidesEl.innerHTML = '';
    dotsEl.innerHTML = '';

    state.list.forEach((p, i) => {
      const slide = document.createElement('section');
      slide.className = 'slide';
      slide.setAttribute('aria-roledescription', 'slide');
      slide.setAttribute('aria-label', `${i + 1} de ${state.list.length}: ${p.title}`);

      const video = document.createElement('video');
      video.className = 'slide__media';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.preload = 'none';
      if (p.poster) video.poster = p.poster;
      slide.appendChild(video);
      slidesEl.appendChild(slide);

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.setAttribute('aria-label', `Ver ${p.title}`);
      dot.innerHTML = `<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9"/></svg><span class="dot__label"></span>`;
      $('.dot__label', dot).textContent = p.title;
      dot.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(dot);
    });

    $('#metaTotal').textContent = pad(state.list.length);
    dotsEl.hidden = state.list.length < 2;
  }

  const slides = () => $$('.slide', slidesEl);
  const pad = (n) => String(n).padStart(2, '0');

  function ensureLoaded(i) {
    const slide = slides()[i];
    if (!slide) return null;
    const video = $('video', slide);
    if (!video.getAttribute('src')) {
      video.src = bgSrcFor(state.list[i]);
      video.preload = 'auto';
    }
    return video;
  }

  function playSlide(i) {
    const video = ensureLoaded(i);
    if (!video) return;
    try { video.currentTime = 0; } catch { /* ainda sem metadata */ }
    video.play().catch(() => {});
  }

  function updateInfo(p, i, instant) {
    const apply = () => {
      $('#infoTitle').textContent = p ? p.title : 'Have Studio Criativo';
      $('#infoTag').textContent = p ? p.subtitle || p.category : 'Produtora audiovisual';
      $('#metaIndex').textContent = pad(i + 1);
      $('#metaCat').textContent = p ? p.category : '';
      $('#infoPlay').hidden = !p;
      $('#infoPlay').classList.toggle('is-external', Boolean(youtubeFor(p)));
      $('#infoPlay').title = youtubeFor(p) ? 'Assistir no YouTube' : '';
      $('#infoPlay').setAttribute(
        'aria-label',
        p
          ? `Assistir ao filme completo de ${p.title}${youtubeFor(p) ? ' no YouTube (abre em nova aba)' : ''}`
          : 'Assistir ao filme completo',
      );
      info.classList.remove('is-changing');
    };
    if (instant) return apply();
    info.classList.add('is-changing');
    setTimeout(apply, 380);
  }

  function updateDots(i) {
    $$('.dot', dotsEl).forEach((d, n) => {
      d.classList.toggle('is-active', n === i);
      d.setAttribute('aria-current', n === i ? 'true' : 'false');
      $('circle', d).style.strokeDashoffset = 56.55;
    });
  }

  function showFirst() {
    state.index = 0;
    state.elapsed = 0;
    const all = slides();
    all.forEach((s) => {
      s.classList.remove('is-active', 'is-leaving', 'enter-up', 'enter-down', 'leave-up', 'leave-down');
      s.style.transform = '';
      s.style.boxShadow = '';
    });
    if (!all.length) return updateInfo(null, 0, true);
    all[0].classList.add('is-active');
    updateInfo(state.list[0], 0, true);
    updateDots(0);
    ensureLoaded(1);
    if (state.started) playSlide(0);
    else ensureLoaded(0);
  }

  /* ---------- transição: dissolve suave (o novo surge por cima do anterior) ---------- */
  function goTo(i, dir) {
    const total = state.list.length;
    if (state.busy || total < 2) return;
    i = (i + total) % total;
    if (i === state.index) return;

    const forward = dir ? dir > 0 : i > state.index;
    const all = slides();
    const prev = all[state.index];
    const next = all[i];
    if (!prev || !next) return;

    state.busy = true;
    state.lastNav = performance.now();
    state.elapsed = 0;
    body.classList.add('has-navigated');

    playSlide(i);
    next.classList.add('is-active', forward ? 'enter-up' : 'enter-down');
    prev.classList.remove('is-active');
    prev.classList.add('is-leaving');

    updateInfo(state.list[i], i);
    updateDots(i);
    state.index = i;

    setTimeout(() => {
      prev.classList.remove('is-leaving');
      $('video', prev)?.pause();
      next.classList.remove('enter-up', 'enter-down');
      state.busy = false;
    }, TRANSITION_MS);

    // pré-carrega vizinhos
    ensureLoaded((i + 1) % total);
    ensureLoaded((i - 1 + total) % total);
  }

  const nextSlide = () => goTo(state.index + 1, 1);
  const prevSlide = () => goTo(state.index - 1, -1);

  /* ---------- avanço automático ---------- */
  const isPaused = () =>
    document.hidden || body.classList.contains('menu-open') || body.classList.contains('modal-open') || !state.started;

  function loop(now) {
    const dt = state.lastTick ? now - state.lastTick : 0;
    state.lastTick = now;
    if (!isPaused() && !state.busy && state.list.length > 1) {
      state.elapsed += dt;
      const dot = $$('.dot', dotsEl)[state.index];
      if (dot) $('circle', dot).style.strokeDashoffset = 56.55 * (1 - Math.min(state.elapsed / SLIDE_DURATION, 1));
      if (state.elapsed >= SLIDE_DURATION) nextSlide();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- navegação ---------- */
  let lastWheel = 0;
  let lastDelta = 0;
  function onWheel(e) {
    if (body.classList.contains('modal-open') || body.classList.contains('menu-open')) return;
    e.preventDefault();
    const now = performance.now();
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const inertia = now - lastWheel < 120 && Math.abs(delta) <= Math.abs(lastDelta);
    lastWheel = now;
    lastDelta = delta;
    if (inertia || Math.abs(delta) < 6 || now - state.lastNav < TRANSITION_MS + 100) return;
    delta > 0 ? nextSlide() : prevSlide();
  }

  let touchStart = null;
  function onTouchStart(e) {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const fast = Date.now() - touchStart.time < 600;
    touchStart = null;
    const dist = Math.abs(dy) > Math.abs(dx) ? dy : dx;
    if (Math.abs(dist) > (fast ? 40 : 90)) dist < 0 ? nextSlide() : prevSlide();
  }

  function onKey(e) {
    if (body.classList.contains('is-intro')) return;
    if (e.key === 'Escape') {
      if (body.classList.contains('modal-open')) closeModal();
      else if (body.classList.contains('menu-open')) toggleMenu(false);
      return;
    }
    if (body.classList.contains('modal-open') || body.classList.contains('menu-open')) return;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); nextSlide(); }
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prevSlide(); }
  }

  /* =========================================================
     PORTFÓLIO (grade com filtros por categoria)
     ========================================================= */
  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>';
  const EXT_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4"/></svg>';

  function renderPortfolio(projects) {
    const grid = $('#pfGrid');
    const filters = $('#pfFilters');
    if (!grid || !filters) return;
    grid.innerHTML = '';
    filters.innerHTML = '';
    $('#pfTotal').textContent = pad(projects.length);
    $('#pfEmpty').hidden = projects.length > 0;

    projects.forEach((p) => {
      const yt = youtubeFor(p);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pf-card';
      card.dataset.cat = p.category || '';
      card.setAttribute('aria-label', `Assistir ${p.title}${p.category ? ` (${p.category})` : ''}${yt ? ', abre no YouTube' : ''}`);
      card.innerHTML = `
        <span class="pf-card__media">${p.poster ? '<img alt="" loading="lazy" decoding="async">' : ''}</span>
        <span class="pf-card__shade" aria-hidden="true"></span>
        <span class="pf-card__play" aria-hidden="true">${PLAY_SVG}${yt ? `<span class="pf-card__ext">${EXT_SVG}</span>` : ''}</span>
        <span class="pf-card__text" aria-hidden="true">
          <span class="pf-card__cat"></span>
          <span class="pf-card__title"></span>
          <span class="pf-card__client"></span>
        </span>`;
      if (p.poster) $('img', card).src = p.poster;
      $('.pf-card__cat', card).textContent = p.category || '';
      $('.pf-card__title', card).textContent = p.title;
      $('.pf-card__client', card).textContent = p.subtitle || p.client || '';

      // prévia em vídeo ao passar o mouse (só no desktop e sem "reduzir movimento")
      const previewSrc = p.preview;
      if (previewSrc && !reduceMotion) {
        let video = null;
        card.addEventListener('pointerenter', (e) => {
          if (e.pointerType !== 'mouse') return;
          if (!video) {
            video = document.createElement('video');
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            video.preload = 'auto';
            video.src = previewSrc;
            video.addEventListener('playing', () => card.classList.add('is-previewing'));
            $('.pf-card__media', card).appendChild(video);
          }
          video.play().catch(() => {});
        });
        card.addEventListener('pointerleave', () => {
          card.classList.remove('is-previewing');
          video?.pause();
        });
      }

      card.addEventListener('click', () => openProject(p));
      grid.appendChild(card);
    });

    // filtros: "Todos" + as categorias que existem nos projetos publicados
    const cats = [...new Set(projects.map((p) => p.category).filter(Boolean))];
    filters.hidden = cats.length < 2;
    ['Todos', ...cats].forEach((cat, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pf-chip';
      chip.textContent = cat;
      chip.setAttribute('aria-pressed', String(i === 0));
      chip.addEventListener('click', () => filterPortfolio(i === 0 ? null : cat, chip));
      filters.appendChild(chip);
    });
    filterPortfolio(null);
  }

  function filterPortfolio(cat, chip) {
    if (chip) $$('.pf-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    let shown = 0;
    $$('.pf-card').forEach((card) => {
      const match = !cat || card.dataset.cat === cat;
      card.hidden = !match;
      if (!match) return;
      // reinicia a animação de entrada, em cascata
      card.classList.remove('is-in');
      card.style.setProperty('--i', shown++);
      void card.offsetWidth;
      card.classList.add('is-in');
    });
    $('#pfShown').textContent = pad(shown);
  }

  /* =========================================================
     MENU MOBILE
     ========================================================= */
  const burger = $('#burger');
  function toggleMenu(force) {
    const open = force ?? !body.classList.contains('menu-open');
    body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    const video = $$('.slide')[state.index]?.querySelector('video');
    if (video) open ? video.pause() : video.play().catch(() => {});
  }

  /* =========================================================
     MODAIS
     ========================================================= */
  let openEl = null;
  let lastFocus = null;

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (openEl && openEl !== el) closeModal(true);
    toggleMenu(false);
    lastFocus = document.activeElement;
    openEl = el;
    el.hidden = false;
    el.scrollTop = 0;
    body.classList.add('modal-open');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    $('[data-close]', el)?.focus({ preventScroll: true });
    const bg = $$('.slide')[state.index]?.querySelector('video');
    if (bg) bg.pause();
    // vídeos decorativos do painel (ex.: abertura do "Conheça a HAVE") só carregam quando ele abre
    if (!reduceMotion) {
      $$('video[data-src]', el).forEach((v) => {
        if (!v.getAttribute('src')) v.src = v.dataset.src;
        v.muted = true;
        v.play().catch(() => {});
      });
    }
  }

  function closeModal(instant) {
    const el = openEl;
    if (!el) return;
    openEl = null;
    el.classList.remove('is-open');
    body.classList.remove('modal-open');
    const done = () => {
      el.hidden = true;
      if (el.id === 'player') {
        // o player recebe um filme novo a cada abertura: libera o anterior
        const v = $('video', el);
        if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
      } else {
        // vídeos fixos dos painéis (ex.: cortes) só pausam, para tocar de novo depois
        $$('video', el).forEach((v) => v.pause());
      }
    };
    instant === true ? done() : setTimeout(done, 450);
    const bg = $$('.slide')[state.index]?.querySelector('video');
    if (bg && state.started) bg.play().catch(() => {});
    if (lastFocus && instant !== true) lastFocus.focus({ preventScroll: true });
  }

  function openProject(p) {
    if (!p) return;
    // Filme completo no YouTube: abre em nova aba em vez do player do site.
    const yt = youtubeFor(p);
    if (yt) {
      window.open(yt, '_blank', 'noopener,noreferrer');
      return;
    }
    $('#playerCat').textContent = p.category || '';
    $('#playerTitle').textContent = p.title;
    $('#playerSub').textContent = p.subtitle || '';
    $('#playerClient').textContent = p.client || '—';
    $('#playerDirector').textContent = p.director || '—';
    $('#playerYear').textContent = p.year || '—';
    $('#playerDesc').textContent = p.description || '';
    // filme completo, do início, com som
    const v = $('#playerVideo');
    v.poster = p.poster || '';
    v.src = fullSrcFor(p);
    v.loop = false;
    v.muted = false;
    openModal('player');
    v.play().catch(() => {});
  }

  /* =========================================================
     FORMULÁRIO DE CONTATO
     ========================================================= */
  function setupForm() {
    const form = $('#contactForm');
    if (!form) return;
    const status = $('#formStatus');
    const btn = $('button[type="submit"]', form);

    const showErrors = (errors = {}) => {
      $$('.field', form).forEach((f) => f.classList.remove('has-error'));
      $$('[data-error]', form).forEach((el) => {
        const msg = errors[el.dataset.error] || '';
        el.textContent = msg;
        if (msg) el.closest('.field').classList.add('has-error');
      });
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));

      const errors = {};
      if (!data.name || data.name.trim().length < 2) errors.name = 'Informe seu nome.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email || '')) errors.email = 'E-mail inválido.';
      if (!data.message || data.message.trim().length < 10) errors.message = 'Conte um pouco mais sobre o projeto (mín. 10 caracteres).';
      showErrors(errors);
      if (Object.keys(errors).length) {
        status.className = 'form__status is-error';
        status.textContent = 'Verifique os campos destacados.';
        return;
      }

      btn.disabled = true;
      status.className = 'form__status';
      status.textContent = 'Enviando…';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          showErrors(json.details);
          throw new Error(json.error || 'Não foi possível enviar agora.');
        }
        form.reset();
        status.className = 'form__status is-ok';
        status.textContent = json.message || 'Mensagem enviada!';
      } catch (err) {
        status.className = 'form__status is-error';
        status.textContent = err.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */
  function bindUI() {
    const reel = $('#reel');
    reel.addEventListener('wheel', onWheel, { passive: false });
    reel.addEventListener('touchstart', onTouchStart, { passive: true });
    reel.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('keydown', onKey);

    $('#infoPlay').addEventListener('click', () => openProject(state.list[state.index]));
    burger.addEventListener('click', () => toggleMenu());

    document.addEventListener('click', (e) => {
      const panel = e.target.closest('[data-panel]');
      if (panel) {
        e.preventDefault();
        openModal(panel.dataset.panel);
        return;
      }
      if (e.target.closest('[data-close]') || (openEl && e.target === openEl)) closeModal();
    });

    document.addEventListener('visibilitychange', () => {
      const v = $$('.slide')[state.index]?.querySelector('video');
      if (!v || !state.started) return;
      document.hidden || body.classList.contains('modal-open') ? v.pause() : v.play().catch(() => {});
    });

    // Cortes: ao dar play em um, pausa o outro
    document.addEventListener('play', (e) => {
      if (!e.target.closest?.('.clips')) return;
      $$('.clips video').forEach((v) => v !== e.target && v.pause());
    }, true);

    setupForm();
    setupReveal();
    $$('.pods').forEach(setupPods);
  }

  /* ---------- Carrosséis de fotos do Estúdio (cada .pods funciona sozinho) ---------- */
  function setupPods(root) {
    const track = $('.pods__track', root);
    if (!track) return;
    const slides = $$('.pods__slide', track);
    const panel = root.closest('.panel');
    const indexEl = $('[data-pods-index]', root);
    const bar = $('.pods__progress span', root);
    const AUTOPLAY_MS = 2000; // cada foto fica 2 s
    const PAUSE_AFTER_USER_MS = 6000; // depois que o visitante mexe, espera um pouco antes de voltar a andar
    let current = 0;
    let lastUser = 0;
    let ticking = false;
    let dest = null; // posição de destino de uma rolagem disparada pelas setas/autoplay

    $('[data-pods-total]', root).textContent = pad(slides.length);

    const maxScroll = () => track.scrollWidth - track.clientWidth;
    const offsetOf = (el) => el.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;

    function nearest() {
      if (track.scrollLeft >= maxScroll() - 4) return slides.length - 1;
      let best = 0;
      let dist = Infinity;
      slides.forEach((s, i) => {
        const d = Math.abs(offsetOf(s) - track.scrollLeft);
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    }

    function update() {
      ticking = false;
      if (dest !== null && Math.abs(track.scrollLeft - dest) <= 4) dest = null;
      if (dest === null) {
        current = nearest();
        indexEl.textContent = pad(current + 1);
      }
      if (!track.scrollWidth) return; // painel ainda fechado
      const seen = (track.scrollLeft + track.clientWidth) / track.scrollWidth;
      bar.style.width = `${Math.min(100, seen * 100)}%`;
    }

    function go(i) {
      const n = slides.length;
      // no fim da faixa as últimas fotos já estão visíveis: o próximo passo volta ao início
      const atEnd = dest === null ? track.scrollLeft >= maxScroll() - 4 : dest >= maxScroll() - 4;
      let target = i;
      if (target >= n || (i > current && atEnd)) target = 0;
      if (target < 0) target = n - 1;
      // cliques rápidos seguem a partir do destino, sem esperar a rolagem terminar
      dest = Math.min(offsetOf(slides[target]), maxScroll());
      current = dest >= maxScroll() - 4 ? n - 1 : target; // no limite, todas as últimas já aparecem
      indexEl.textContent = pad(current + 1);
      track.scrollTo({ left: dest, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    const userAct = () => { lastUser = Date.now(); };
    $('[data-pods-prev]', root).addEventListener('click', () => { userAct(); go(current - 1); });
    $('[data-pods-next]', root).addEventListener('click', () => { userAct(); go(current + 1); });
    // rolagem manual (arrastar, roda do mouse, teclado) cancela o destino das setas
    const manual = () => { userAct(); dest = null; };
    track.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((ev) => track.addEventListener(ev, manual, { passive: true }));
    // Recalcula quando o painel abre (antes disso o carrossel não tem tamanho) e quando as fotos carregam.
    if ('ResizeObserver' in window) new ResizeObserver(() => update()).observe(track);
    else addEventListener('resize', update);
    slides.forEach((s) => $('img', s).addEventListener('load', update, { once: true }));

    // Avança sozinho enquanto o painel do estúdio está aberto e ninguém está mexendo.
    if (!reduceMotion) {
      setInterval(() => {
        if (panel?.hidden || document.hidden) return;
        if (root.querySelector(':focus-visible')) return; // pausa enquanto alguém navega pelo teclado
        if (Date.now() - lastUser < PAUSE_AFTER_USER_MS) return;
        go(current + 1);
      }, AUTOPLAY_MS);
    }

    update();
  }

  function setupReveal() {
    $$('.panel.about').forEach((panel) => {
      const items = $$('.reveal', panel);
      if (!('IntersectionObserver' in window)) return items.forEach((el) => el.classList.add('is-in'));
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }),
        { root: panel, threshold: 0.12 },
      );
      items.forEach((el) => io.observe(el));
    });
  }

  async function init() {
    bindUI();
    loadContactInfo();
    const introDone = runIntro();
    const projects = await loadProjects();
    state.all = projects;
    state.list = projects;
    render();
    showFirst();
    renderPortfolio(projects);

    await introDone;
    state.started = true;
    if (state.list.length) playSlide(state.index);
    requestAnimationFrame(loop);

    const hash = location.hash.slice(1);
    if (['contato', 'sobre', 'estudio', 'redes', 'portfolio'].includes(hash)) setTimeout(() => openModal(hash), 900);
  }

  init();
})();