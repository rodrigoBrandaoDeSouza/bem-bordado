(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CAT_LABEL = { bordado: 'Bordado', croche: 'Crochê', 'bordado-croche': 'Bordado + Crochê', outro: 'Outro' };
  const PIN_COLORS = ['var(--sun)', 'var(--ink)', 'var(--sun-dark)', 'var(--sage)'];

  let settings = {};
  let works = [];
  let visibleWorks = [];
  let lbIndex = 0;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  const whatsLink = (msg = '') =>
    settings.whatsapp ? `https://wa.me/${settings.whatsapp}${msg ? `?text=${encodeURIComponent(msg)}` : ''}` : '';

  /* ---------------- Configurações (nome, insta, whats, sobre) ---------------- */
  async function loadSettings() {
    try {
      settings = await (await fetch('/api/settings')).json();
    } catch {
      return;
    }
    $$('[data-setting]').forEach((el) => {
      const v = settings[el.dataset.setting];
      if (v) el.textContent = v;
    });
    if (settings.brand_name) document.title = `${settings.brand_name} · Bordados e crochê feitos à mão`;
    $$('[data-insta]').forEach((a) => (a.href = `https://www.instagram.com/${encodeURIComponent(settings.instagram || '')}/`));
    const w = whatsLink(`Olá! Vim pelo site da ${settings.brand_name || 'Bem Bordado'} 🧵`);
    $$('[data-whats]').forEach((a) => {
      if (w) { a.href = w; a.hidden = false; }
    });
  }

  /* ---------------- Galeria ---------------- */
  async function loadWorks() {
    const g = $('#gallery');
    try {
      works = await (await fetch('/api/works')).json();
    } catch {
      g.innerHTML = '<div class="gallery-empty">Não consegui carregar os trabalhos agora.</div>';
      return;
    }
    if (!works.length) {
      g.innerHTML = '<div class="gallery-empty">Em breve, novos trabalhos por aqui ✿</div>';
      return;
    }
    g.innerHTML = works
      .map((w, i) => {
        const tilt = ((i * 37) % 5) - 2;
        return `<button class="work" data-id="${w.id}" data-cat="${esc(w.category)}" style="--tilt:${tilt * 0.6}deg;--pin:${PIN_COLORS[i % PIN_COLORS.length]}" aria-label="Ver ${esc(w.title)}">
          <span class="pin" aria-hidden="true"></span>
          ${w.featured ? '<span class="featured">queridinho</span>' : ''}
          <div class="work-img"><img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy"></div>
          <h3>${esc(w.title)}</h3>
          <div class="meta"><span class="tag">${esc(CAT_LABEL[w.category] || w.category)}</span>${w.price_from ? `<span>a partir de ${brl(w.price_from)}</span>` : ''}</div>
        </button>`;
      })
      .join('');
    applyFilter('todos', false);
  }

  function applyFilter(f, animate = true) {
    $$('.chip').forEach((c) => {
      const on = c.dataset.filter === f;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', on);
    });
    visibleWorks = [];
    $$('.work').forEach((el, i) => {
      const show = f === 'todos' || el.dataset.cat === f;
      el.classList.toggle('hide', !show);
      if (show) {
        visibleWorks.push(Number(el.dataset.id));
        if (animate && !reduced) {
          el.classList.remove('enter');
          void el.offsetWidth;
          el.style.animationDelay = `${visibleWorks.length * 50}ms`;
          el.classList.add('enter');
        }
      }
    });
    if (!visibleWorks.length) toast('Ainda não há peças nessa categoria.');
  }

  $('.filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) applyFilter(c.dataset.filter);
  });

  /* ---------------- Lightbox ---------------- */
  const lb = $('#lightbox');
  function openLightbox(id) {
    lbIndex = visibleWorks.indexOf(id);
    renderLightbox();
    if (!lb.open) lb.showModal();
  }
  function renderLightbox() {
    const w = works.find((x) => x.id === visibleWorks[lbIndex]);
    if (!w) return;
    $('#lbImg').src = w.image;
    $('#lbImg').alt = w.title;
    $('#lbTag').textContent = CAT_LABEL[w.category] || w.category;
    $('#lbTitle').textContent = w.title;
    $('#lbDesc').textContent = w.description || '';
    $('#lbPrice').textContent = w.price_from ? `a partir de ${brl(w.price_from)}` : 'valor sob consulta';
    $('#lbOrder').dataset.id = w.id;
    const multi = visibleWorks.length > 1;
    $$('.lb-nav', lb).forEach((b) => (b.hidden = !multi));
  }
  const step = (d) => {
    lbIndex = (lbIndex + d + visibleWorks.length) % visibleWorks.length;
    renderLightbox();
  };
  $('#gallery').addEventListener('click', (e) => {
    const card = e.target.closest('.work');
    if (card) openLightbox(Number(card.dataset.id));
  });
  $('.lb-close').addEventListener('click', () => lb.close());
  $('.lb-prev').addEventListener('click', () => step(-1));
  $('.lb-next').addEventListener('click', () => step(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  let touchX = null;
  lb.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
  });

  $('#lbOrder').addEventListener('click', (e) => {
    const w = works.find((x) => x.id === Number(e.currentTarget.dataset.id));
    lb.close();
    if (w) setReference(w);
    $('#encomendar').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ---------------- Formulário de encomenda ---------------- */
  const form = $('#orderForm');

  function setReference(w) {
    $('#refWork').hidden = false;
    $('#refWorkImg').src = w.image;
    $('#refWorkTitle').textContent = w.title;
    $('#workId').value = w.id;
    const radio = form.querySelector(`input[name="categoria"][value="${w.category}"]`);
    if (radio) radio.checked = true;
    const desc = form.elements.descricao;
    if (!desc.value) desc.value = `Gostaria de uma peça parecida com “${w.title}”. `;
  }
  $('#refWorkClear').addEventListener('click', () => {
    $('#refWork').hidden = true;
    $('#workId').value = '';
  });

  // data mínima = hoje
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  $('#desiredDate').min = today.toISOString().slice(0, 10);

  // máscara simples de telefone
  form.elements.whatsapp.addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 13);
    let out = d;
    if (d.length > 2) out = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) out = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    e.target.value = out;
  });

  // stepper
  $$('.stepper button').forEach((b) =>
    b.addEventListener('click', () => {
      const inp = b.parentElement.querySelector('input');
      inp.value = Math.max(1, Math.min(999, (parseInt(inp.value, 10) || 1) + Number(b.dataset.step)));
    })
  );

  // foto de referência
  const fileInput = $('#fileInput');
  const drop = $('#fileDrop');
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    const prev = $('.file-preview', drop);
    if (!f) { prev.hidden = true; $('.file-drop-text em', drop).textContent = 'Escolher imagem'; return; }
    if (f.size > 6 * 1024 * 1024) {
      toast('A imagem pode ter no máximo 6 MB.');
      fileInput.value = '';
      return;
    }
    prev.src = URL.createObjectURL(f);
    prev.hidden = false;
    $('.file-drop-text em', drop).textContent = f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name;
  });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('drag')));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));

  function showError(msg) {
    const box = $('.form-error', form);
    box.textContent = msg;
    box.hidden = !msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));

    const el = form.elements;
    const problems = [];
    if (!form.querySelector('input[name="categoria"]:checked')) problems.push(['Escolha o tipo de peça.', null]);
    if (el.nome.value.trim().length < 2) problems.push(['Conte seu nome, por favor.', el.nome]);
    if (el.whatsapp.value.replace(/\D/g, '').length < 10) problems.push(['Informe um WhatsApp com DDD.', el.whatsapp]);
    if (el.email.value && !el.email.checkValidity()) problems.push(['Confira o e-mail.', el.email]);
    if (el.descricao.value.trim().length < 5) problems.push(['Descreva um pouquinho a sua ideia.', el.descricao]);
    if (problems.length) {
      problems.forEach(([, f]) => f && f.classList.add('invalid'));
      showError(problems[0][0]);
      (problems[0][1] || form.querySelector('.type-opt input'))?.focus();
      return;
    }

    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.classList.add('loading');
    $('.btn-label', btn).textContent = 'Enviando…';
    try {
      const res = await fetch('/api/orders', { method: 'POST', body: new FormData(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível enviar. Tente novamente.');
      showTicket(data.code, el.nome.value.trim());
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('.btn-label', btn).textContent = 'Enviar encomenda';
    }
  });

  function showTicket(code, name) {
    form.hidden = true;
    const t = $('#ticket');
    t.hidden = false;
    $('#ticketCode').textContent = code;
    const w = whatsLink(`Olá! Sou ${name} e acabei de fazer a encomenda ${code} pelo site 🧵`);
    const a = $('#ticketWhats');
    if (w) { a.href = w; a.hidden = false; }
    t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    confetti();
  }

  $('#copyCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#ticketCode').textContent);
      toast('Código copiado!');
    } catch {
      toast('Não consegui copiar — anote o código, tá?');
    }
  });

  $('#newOrder').addEventListener('click', () => {
    form.reset();
    $('#refWork').hidden = true;
    $('#workId').value = '';
    $('.file-preview', drop).hidden = true;
    $('.file-drop-text em', drop).textContent = 'Escolher imagem';
    $('#ticket').hidden = true;
    form.hidden = false;
    form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ---------------- Acompanhar pedido ---------------- */
  const STEPS = [
    ['novo', 'Recebida'],
    ['orcamento', 'Orçamento'],
    ['producao', 'Em produção'],
    ['pronto', 'Pronta'],
    ['entregue', 'Entregue'],
  ];
  const fmtDate = (d) => (d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '');

  $('#trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let code = e.target.code.value.trim().toUpperCase().replace(/\s/g, '');
    if (code && !code.startsWith('BB-')) code = 'BB-' + code.replace(/^BB/, '');
    const box = $('#trackResult');
    box.hidden = false;
    box.innerHTML = '<p class="muted">Procurando…</p>';
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(code)}`);
      const o = await res.json();
      if (!res.ok) throw new Error(o.error);
      const idx = STEPS.findIndex(([k]) => k === o.status);
      const cancelled = o.status === 'cancelado';
      box.innerHTML = `
        <h3>Pedido ${esc(o.code)}</h3>
        <p class="muted">${esc(CAT_LABEL[o.category] || '')} · feito em ${fmtDate(o.created_at)}${o.due_date && !cancelled ? ` · previsão de entrega: <strong>${fmtDate(o.due_date)}</strong>` : ''}</p>
        ${cancelled ? '<p class="track-cancel">Este pedido foi cancelado. Qualquer dúvida, me chame no WhatsApp.</p>' : `
        <ol class="timeline">
          <span class="bar"></span>
          ${STEPS.map(([, label], i) => `<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}"><i>${i < idx ? '✓' : i + 1}</i>${label}</li>`).join('')}
        </ol>`}`;
      const bar = $('.bar', box);
      if (bar) requestAnimationFrame(() => (bar.style.width = `${(Math.max(0, idx) / (STEPS.length - 1)) * 80}%`));
    } catch (err) {
      box.innerHTML = `<p class="track-cancel">${esc(err.message || 'Não encontrei esse pedido.')}</p>`;
    }
  });

  /* ---------------- Menu mobile ---------------- */
  const toggle = $('.menu-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open);
    $('#menu').classList.toggle('open', open);
  });
  $('#menu').addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      toggle.setAttribute('aria-expanded', 'false');
      $('#menu').classList.remove('open');
    }
  });

  /* ---------------- Revelar ao rolar ---------------- */
  $$('.section-head, .step, .pattern-card, .about-text, .about-art, .track-form').forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          $$('.stitched-title', en.target).forEach((t) => t.classList.add('in'));
          io.unobserve(en.target);
        }
      }),
    { threshold: 0.15 }
  );
  $$('.reveal').forEach((el) => io.observe(el));

  /* ---------------- Linha que segue o cursor ---------------- */
  function threadTrail() {
    if (reduced || matchMedia('(pointer: coarse)').matches) return;
    const cv = $('#thread');
    const ctx = cv.getContext('2d');
    let pts = [];
    let raf = null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);

    addEventListener('pointermove', (e) => {
      pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (!raf) raf = requestAnimationFrame(draw);
    }, { passive: true });

    function draw() {
      const now = performance.now();
      pts = pts.filter((p) => now - p.t < 700).slice(-40);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (pts.length > 2) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 5]);
        ctx.lineDashOffset = -now / 30;
        for (let i = 1; i < pts.length - 1; i++) {
          const a = pts[i - 1], b = pts[i], c = pts[i + 1];
          const alpha = Math.max(0, 1 - (now - b.t) / 700) * 0.75;
          ctx.strokeStyle = `rgba(37, 34, 32, ${alpha * 0.8})`;
          ctx.beginPath();
          ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
          ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
          ctx.stroke();
        }
      }
      raf = pts.length ? requestAnimationFrame(draw) : null;
      if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  /* ---------------- Confete de botõezinhos ---------------- */
  function confetti() {
    if (reduced) return;
    const colors = ['#f6c324', '#252220', '#fde58c', '#b58a06', '#6f7d3c', '#fffdf7'];
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:90;overflow:hidden';
    document.body.appendChild(host);
    for (let i = 0; i < 46; i++) {
      const b = document.createElement('i');
      const size = 10 + Math.random() * 12;
      const c = colors[i % colors.length];
      b.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:-30px;width:${size}px;height:${size}px;border-radius:50%;
        background:radial-gradient(circle at 35% 35%,#0003 1.2px,transparent 1.6px),radial-gradient(circle at 65% 35%,#0003 1.2px,transparent 1.6px),radial-gradient(circle at 35% 65%,#0003 1.2px,transparent 1.6px),radial-gradient(circle at 65% 65%,#0003 1.2px,transparent 1.6px),${c}`;
      host.appendChild(b);
      b.animate(
        [
          { transform: 'translate(0,0) rotate(0)' },
          { transform: `translate(${(Math.random() - 0.5) * 240}px, ${innerHeight + 60}px) rotate(${Math.random() * 720}deg)` },
        ],
        { duration: 1800 + Math.random() * 1600, easing: 'cubic-bezier(.3,.6,.6,1)', delay: Math.random() * 300, fill: 'forwards' }
      );
    }
    setTimeout(() => host.remove(), 4000);
  }

  /* ---------------- Novelo arrastável (brincadeira) ---------------- */
  const yarn = $('.yarn');
  if (yarn) {
    yarn.addEventListener('click', () => {
      if (reduced) return;
      yarn.animate(
        [{ transform: 'translateX(0) rotate(0)' }, { transform: 'translateX(40px) rotate(220deg)' }, { transform: 'translateX(0) rotate(360deg)' }],
        { duration: 1100, easing: 'cubic-bezier(.3,1.3,.5,1)' }
      );
    });
  }

  loadSettings();
  loadWorks();
  threadTrail();
})();
