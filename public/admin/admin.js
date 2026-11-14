(() => {
  'use strict';

  /* ================= Utilitários ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const STATUS = {
    novo: 'Nova',
    orcamento: 'Orçamento',
    producao: 'Em produção',
    pronto: 'Pronta',
    entregue: 'Entregue',
    cancelado: 'Cancelada',
  };
  const ACTIVE = ['novo', 'orcamento', 'producao', 'pronto'];
  const CAT = { bordado: 'Bordado', croche: 'Crochê', 'bordado-croche': 'Bordado + Crochê', outro: 'Outro' };

  function localISO(d = new Date()) {
    const z = new Date(d);
    z.setMinutes(z.getMinutes() - z.getTimezoneOffset());
    return z.toISOString().slice(0, 10);
  }
  const TODAY = () => localISO();
  const parseDay = (s) => new Date(`${s.slice(0, 10)}T12:00:00`);
  const fmtDate = (s, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) => (s ? parseDay(s).toLocaleDateString('pt-BR', opts) : '—');
  // created_at / paid_at vêm em UTC ("YYYY-MM-DD HH:MM:SS")
  const utcToLocalDay = (s) => (s ? localISO(new Date(s.replace(' ', 'T') + 'Z')) : null);
  const daysUntil = (s) => Math.round((parseDay(s) - parseDay(TODAY())) / 86400000);

  function deadlineBadge(o) {
    if (!ACTIVE.includes(o.status)) return o.due_date ? `<span class="pill d-ok">${fmtDate(o.due_date)}</span>` : '';
    if (!o.due_date) return '<span class="pill d-none">sem prazo</span>';
    const d = daysUntil(o.due_date);
    if (d < 0) return `<span class="pill d-late">⚠ atrasada ${-d} ${-d === 1 ? 'dia' : 'dias'}</span>`;
    if (d === 0) return '<span class="pill d-soon">⏰ entrega hoje</span>';
    if (d === 1) return '<span class="pill d-soon">amanhã</span>';
    if (d <= 7) return `<span class="pill d-soon">em ${d} dias</span>`;
    return `<span class="pill d-ok">${fmtDate(o.due_date, { day: '2-digit', month: 'short' })} · ${d} dias</span>`;
  }
  const isLate = (o) => ACTIVE.includes(o.status) && o.due_date && daysUntil(o.due_date) < 0;

  function payState(o) {
    if (!(o.total_value > 0)) return 'semvalor';
    if (o.paid_value >= o.total_value) return 'pago';
    if (o.paid_value > 0) return 'parcial';
    return 'pendente';
  }
  const PAY_LABEL = { pago: '✓ Pago', parcial: 'Sinal pago', pendente: 'A receber', semvalor: 'Sem valor' };
  const payPill = (o) => `<span class="pill p-${payState(o)}">${PAY_LABEL[payState(o)]}</span>`;
  const statusPill = (s) => `<span class="pill s-${s}">${STATUS[s] || s}</span>`;

  const waLink = (phone, msg = '') => {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 11) d = '55' + d;
    return `https://wa.me/${d}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(url, opts = {}) {
    const o = { credentials: 'same-origin', ...opts };
    if (o.body && !(o.body instanceof FormData)) {
      o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
      o.body = JSON.stringify(o.body);
    }
    const res = await fetch(url, o);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) {
      showLogin();
      throw new Error(data.error || 'Sessão expirada.');
    }
    if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
    return data;
  }

  /* ================= Estado ================= */
  const state = {
    user: null,
    orders: [],
    works: [],
    settings: {},
    period: 'mes',
    filter: { status: 'ativas', pay: 'todos', q: '', sort: 'prazo' },
    calMonth: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  };

  /* ================= Login ================= */
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $$('dialog[open]').forEach((d) => d.close());
    setTimeout(() => $('#loginForm').username.focus(), 50);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.err', f);
    err.hidden = true;
    const btn = $('button[type="submit"]', f);
    btn.disabled = true;
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      state.user = { username: r.username };
      f.password.value = '';
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  $('.pw-toggle').addEventListener('click', () => {
    const i = $('#loginForm').password;
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  $('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    showLogin();
  });

  /* ================= Boot / dados ================= */
  async function loadAll() {
    const [orders, works, settings] = await Promise.all([
      api('/api/admin/orders'),
      api('/api/admin/works'),
      api('/api/admin/settings'),
    ]);
    state.orders = orders;
    state.works = works;
    state.settings = settings;
    updateBadges();
  }

  async function boot() {
    try {
      if (!state.user) state.user = await api('/api/admin/me');
    } catch {
      return showLogin();
    }
    $('#login').hidden = true;
    $('#app').hidden = false;
    const h = new Date().getHours();
    $('#hello').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}! ✿`;
    try {
      await loadAll();
    } catch (e) {
      toast(e.message);
    }
    $('#sideBrand').textContent = state.settings.brand_name || 'Bem Bordado';
    route();
  }

  function updateBadges() {
    const novas = state.orders.filter((o) => o.status === 'novo').length;
    const late = state.orders.filter(isLate).length;
    $('#navNew').textContent = novas;
    $('#navNew').hidden = !novas;
    $('#navLate').textContent = late;
    $('#navLate').hidden = !late;
  }

  $('#refresh').addEventListener('click', async () => {
    try {
      await loadAll();
      route();
      toast('Tudo atualizado!');
    } catch (e) {
      toast(e.message);
    }
  });

  // atualiza sozinho a cada 2 minutos (novas encomendas do site)
  setInterval(async () => {
    if ($('#app').hidden || $$('dialog[open]').length) return;
    const before = state.orders.length;
    try {
      await loadAll();
      if (state.orders.length > before) toast(`✿ ${state.orders.length - before} nova(s) encomenda(s)!`);
      route();
    } catch {}
  }, 120000);

  /* ================= Rotas ================= */
  const VIEWS = {
    painel: ['Painel', renderDashboard],
    encomendas: ['Encomendas', renderOrders],
    prazos: ['Prazos', renderCalendar],
    trabalhos: ['Trabalhos', renderWorks],
    config: ['Configurações', renderSettings],
  };
  function route() {
    const key = (location.hash || '#painel').slice(1);
    const [title, fn] = VIEWS[key] || VIEWS.painel;
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === (VIEWS[key] ? key : 'painel')));
    $('#viewTitle').textContent = title;
    fn($('#view'));
  }
  addEventListener('hashchange', () => { if (!$('#app').hidden) { route(); scrollTo(0, 0); } });

  /* ================= Painel ================= */
  const PERIODS = { mes: 'Este mês', '3m': 'Últimos 3 meses', ano: 'Este ano', tudo: 'Tudo' };
  function inPeriod(day, p) {
    if (!day) return false;
    if (p === 'tudo') return true;
    const now = new Date();
    const d = parseDay(day);
    if (p === 'mes') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (p === 'ano') return d.getFullYear() === now.getFullYear();
    if (p === '3m') return d >= new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return true;
  }

  function renderDashboard(root) {
    const all = state.orders.filter((o) => o.status !== 'cancelado');
    const period = all.filter((o) => inPeriod(utcToLocalDay(o.created_at), state.period));
    const active = all.filter((o) => ACTIVE.includes(o.status));

    const sum = (arr, f) => arr.reduce((s, o) => s + (Number(f(o)) || 0), 0);
    const vendido = sum(period, (o) => o.total_value);
    const recebidoPeriodo = sum(period, (o) => Math.min(o.paid_value, o.total_value || o.paid_value));
    const aReceber = sum(all, (o) => Math.max(0, o.total_value - o.paid_value));
    const pendentesCount = all.filter((o) => o.total_value - o.paid_value > 0.001).length;
    const late = active.filter(isLate);
    const soon = active.filter((o) => o.due_date && daysUntil(o.due_date) >= 0 && daysUntil(o.due_date) <= 7);
    const comValor = period.filter((o) => o.total_value > 0);
    const ticket = comValor.length ? vendido / comValor.length : 0;

    const upcoming = active
      .filter((o) => o.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 8);
    const noDue = active.filter((o) => !o.due_date).length;
    const toReceive = all
      .filter((o) => o.total_value - o.paid_value > 0.001)
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))
      .slice(0, 8);

    root.innerHTML = `
      <div class="period" role="tablist" aria-label="Período">
        ${Object.entries(PERIODS).map(([k, v]) => `<button class="chip ${state.period === k ? 'on' : ''}" data-period="${k}">${v}</button>`).join('')}
      </div>

      <div class="kpis">
        <div class="card kpi k-rose">
          <div class="label">Vendido · ${PERIODS[state.period].toLowerCase()}</div>
          <div class="value">${brl(vendido)}</div>
          <div class="hint">${period.length} encomenda(s) · ticket médio ${brl(ticket)}</div>
        </div>
        <div class="card kpi k-blue">
          <div class="label">Recebido dessas encomendas</div>
          <div class="value">${brl(recebidoPeriodo)}</div>
          <div class="hint">${vendido ? Math.round((recebidoPeriodo / vendido) * 100) : 0}% do vendido no período</div>
        </div>
        <div class="card kpi k-amber clickable" data-go="pay">
          <div class="label">A receber (total)</div>
          <div class="value">${brl(aReceber)}</div>
          <div class="hint">${pendentesCount} encomenda(s) com saldo</div>
        </div>
        <div class="card kpi ${late.length ? 'k-red' : ''} clickable" data-go="prazos">
          <div class="label">Em andamento</div>
          <div class="value">${active.length}</div>
          <div class="hint">${late.length ? `<b style="color:var(--red)">${late.length} atrasada(s)</b> · ` : ''}${soon.length} vence(m) em 7 dias</div>
        </div>
      </div>

      <div class="dash-grid">
        <section class="card">
          <h2>Próximos prazos <small>${noDue ? `${noDue} sem prazo definido` : ''}</small></h2>
          <div class="list">
            ${upcoming.length ? upcoming.map((o) => `
              <div class="li" data-open="${o.id}" tabindex="0">
                <div class="who">${esc(o.customer_name)}</div>
                <div class="what">${esc(CAT[o.category] || '')} · ${esc(o.description)}</div>
                <div class="right">${deadlineBadge(o)}${statusPill(o.status)}</div>
              </div>`).join('') : '<div class="empty">Nenhum prazo pela frente ✿</div>'}
          </div>
        </section>

        <section class="card">
          <h2>A receber <small>${brl(aReceber)}</small></h2>
          <div class="list">
            ${toReceive.length ? toReceive.map((o) => `
              <div class="li" data-open="${o.id}" tabindex="0">
                <div class="who">${esc(o.customer_name)}</div>
                <div class="what">falta ${brl(o.total_value - o.paid_value)} de ${brl(o.total_value)}</div>
                <div class="right">${payPill(o)}<button class="icon-btn pay" data-pay="${o.id}">Marcar pago</button></div>
              </div>`).join('') : '<div class="empty">Tudo recebido! 💛</div>'}
          </div>
        </section>

        <section class="card wide">
          <h2>Encomendas por mês <span class="chart-legend"><span><i style="background:var(--chart-a)"></i>Vendido</span><span><i style="background:var(--blue)"></i>Recebido</span></span></h2>
          ${monthChart(all)}
        </section>
      </div>`;

    $$('[data-period]', root).forEach((b) => b.addEventListener('click', () => { state.period = b.dataset.period; renderDashboard(root); }));
    $$('[data-go]', root).forEach((c) =>
      c.addEventListener('click', () => {
        if (c.dataset.go === 'pay') { state.filter = { ...state.filter, status: 'todas', pay: 'areceber' }; location.hash = '#encomendas'; }
        else location.hash = '#prazos';
      })
    );
    bindListClicks(root);
  }

  function monthChart(orders) {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), full: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), a: 0, b: 0, n: 0 });
    }
    for (const o of orders) {
      const k = (utcToLocalDay(o.created_at) || '').slice(0, 7);
      const m = months.find((x) => x.key === k);
      if (m) { m.a += o.total_value || 0; m.b += Math.min(o.paid_value || 0, o.total_value || o.paid_value || 0); m.n++; }
    }
    const max = Math.max(1, ...months.map((m) => Math.max(m.a, m.b)));
    const table = `<table class="sr-only" style="position:absolute;left:-9999px"><caption>Vendido e recebido por mês</caption><tr><th>Mês</th><th>Vendido</th><th>Recebido</th></tr>${months.map((m) => `<tr><td>${m.full}</td><td>${brl(m.a)}</td><td>${brl(m.b)}</td></tr>`).join('')}</table>`;
    return `<div class="chart" style="--n:${months.length}">
      ${months.map((m) => `
        <div class="col" tabindex="0">
          <div class="bar a" style="height:${(m.a / max) * 100}%"></div>
          <div class="bar b" style="height:${(m.b / max) * 100}%"></div>
          <span class="xl">${m.label}</span>
          <div class="tip"><div style="text-transform:capitalize;margin-bottom:3px"><b>${m.full}</b> · ${m.n} pedido(s)</div>
            <div><i style="background:var(--chart-a)"></i>Vendido <b>${brl(m.a)}</b></div>
            <div><i style="background:var(--blue)"></i>Recebido <b>${brl(m.b)}</b></div></div>
        </div>`).join('')}
    </div>${table}`;
  }

  function bindListClicks(root) {
    $$('[data-open]', root).forEach((el) => {
      el.addEventListener('click', (e) => { if (!e.target.closest('button, a, select')) openOrder(Number(el.dataset.open)); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) openOrder(Number(el.dataset.open)); });
    });
    $$('[data-pay]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markPaid(Number(b.dataset.pay)); }));
  }

  async function markPaid(id) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return;
    if (!(o.total_value > 0)) {
      toast('Defina o valor da encomenda primeiro.');
      return openOrder(id);
    }
    if (!confirm(`Marcar a encomenda de ${o.customer_name} como paga (${brl(o.total_value)})?`)) return;
    try {
      const updated = await api(`/api/admin/orders/${id}/pay`, { method: 'POST' });
      replaceOrder(updated);
      toast('💰 Marcada como paga!');
      route();
    } catch (e) {
      toast(e.message);
    }
  }

  function replaceOrder(updated) {
    const i = state.orders.findIndex((x) => x.id === updated.id);
    const keep = i >= 0 ? { work_title: state.orders[i].work_title, work_image: state.orders[i].work_image } : {};
    if (i >= 0) state.orders[i] = { ...keep, ...updated };
    else state.orders.unshift(updated);
    updateBadges();
  }

  /* ================= Encomendas ================= */
  const STATUS_TABS = { ativas: 'Em aberto', todas: 'Todas', ...STATUS };

  function filteredOrders() {
    const f = state.filter;
    const q = f.q.trim().toLowerCase();
    let list = state.orders.filter((o) => {
      if (f.status === 'ativas' && !ACTIVE.includes(o.status)) return false;
      if (f.status !== 'ativas' && f.status !== 'todas' && o.status !== f.status) return false;
      const ps = payState(o);
      if (f.pay === 'areceber' && !(ps === 'pendente' || ps === 'parcial')) return false;
      if (f.pay !== 'todos' && f.pay !== 'areceber' && ps !== f.pay) return false;
      if (q && !`${o.code} ${o.customer_name} ${o.phone} ${o.description} ${o.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const byDue = (a, b) => (a.due_date || '9999-99').localeCompare(b.due_date || '9999-99');
    if (f.sort === 'prazo') list.sort(byDue);
    if (f.sort === 'recentes') list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (f.sort === 'valor') list.sort((a, b) => b.total_value - a.total_value);
    return list;
  }

  function renderOrders(root) {
    const counts = (k) =>
      k === 'todas' ? state.orders.length : k === 'ativas' ? state.orders.filter((o) => ACTIVE.includes(o.status)).length : state.orders.filter((o) => o.status === k).length;
    const f = state.filter;
    root.innerHTML = `
      <div class="status-tabs">
        ${Object.entries(STATUS_TABS).map(([k, v]) => `<button class="chip ${f.status === k ? 'on' : ''}" data-st="${k}">${v}<span class="n">${counts(k)}</span></button>`).join('')}
      </div>
      <div class="toolbar">
        <input class="search" type="search" placeholder="Buscar por nome, código, telefone…" value="${esc(f.q)}" aria-label="Buscar">
        <select id="fPay" aria-label="Pagamento">
          <option value="todos">Pagamento: todos</option>
          <option value="areceber">A receber (pendente + sinal)</option>
          <option value="pendente">Nada pago</option>
          <option value="parcial">Só sinal</option>
          <option value="pago">Pagos</option>
          <option value="semvalor">Sem valor definido</option>
        </select>
        <select id="fSort" aria-label="Ordenar">
          <option value="prazo">Ordenar: prazo mais próximo</option>
          <option value="recentes">Mais recentes</option>
          <option value="valor">Maior valor</option>
        </select>
      </div>
      <div class="orders" id="ordersList"></div>`;
    $('#fPay').value = f.pay;
    $('#fSort').value = f.sort;

    const list = () => {
      const items = filteredOrders();
      const box = $('#ordersList');
      if (!items.length) {
        box.innerHTML = '<div class="card empty">Nenhuma encomenda por aqui.</div>';
        return;
      }
      const total = items.reduce((s, o) => s + (o.status === 'cancelado' ? 0 : o.total_value), 0);
      const paid = items.reduce((s, o) => s + (o.status === 'cancelado' ? 0 : o.paid_value), 0);
      box.innerHTML =
        `<p class="muted" style="margin:0 0 4px">${items.length} encomenda(s) · ${brl(total)} no total · ${brl(paid)} recebido · <b>${brl(Math.max(0, total - paid))}</b> a receber</p>` +
        items.map(orderRow).join('');
      bindOrderRows(box);
    };
    list();

    $$('[data-st]', root).forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.st; renderOrders(root); }));
    $('.search', root).addEventListener('input', (e) => { f.q = e.target.value; list(); });
    $('#fPay').addEventListener('change', (e) => { f.pay = e.target.value; list(); });
    $('#fSort').addEventListener('change', (e) => { f.sort = e.target.value; list(); });
  }

  function orderRow(o) {
    const pct = o.total_value > 0 ? Math.min(100, (o.paid_value / o.total_value) * 100) : 0;
    const wa = waLink(o.phone, `Olá ${o.customer_name.split(' ')[0]}! Aqui é da ${state.settings.brand_name || 'Bem Bordado'} sobre sua encomenda ${o.code} 🧵`);
    return `
      <article class="order ${isLate(o) ? 'is-late' : ''}" data-id="${o.id}">
        <div class="o-main" data-open="${o.id}" tabindex="0">
          <div class="o-top"><span class="o-name">${esc(o.customer_name)}</span><span class="o-code">${esc(o.code)}</span>${o.source === 'site' ? '' : '<span class="pill d-ok">manual</span>'}</div>
          <div class="o-desc">${o.quantity > 1 ? `${o.quantity}× ` : ''}${esc(CAT[o.category] || '')} · ${esc(o.description)}</div>
        </div>
        <div class="o-col o-status">
          <small>Status</small>
          <select data-status="${o.id}" class="s-${o.status}" aria-label="Status">
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <div style="margin-top:6px">${deadlineBadge(o)}</div>
        </div>
        <div class="o-col">
          <small>Valor</small>
          ${o.total_value > 0
            ? `<div class="money">${brl(o.total_value)}</div><div class="progress"><span style="width:${pct}%"></span></div><div class="money-sub">${payPill(o)} ${o.paid_value > 0 && o.paid_value < o.total_value ? `${brl(o.paid_value)} pago` : ''}</div>`
            : '<div class="money-sub">a definir</div>'}
        </div>
        <div class="o-actions">
          ${payState(o) === 'pendente' || payState(o) === 'parcial' ? `<button class="icon-btn pay" data-pay="${o.id}" title="Marcar como pago">💰 Pago</button>` : ''}
          ${wa ? `<a class="icon-btn" href="${esc(wa)}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
          <button class="icon-btn" data-open="${o.id}" title="Abrir">✎</button>
        </div>
      </article>`;
  }

  function bindOrderRows(box) {
    bindListClicks(box);
    $$('[data-status]', box).forEach((sel) =>
      sel.addEventListener('change', async () => {
        const id = Number(sel.dataset.status);
        try {
          const updated = await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status: sel.value } });
          replaceOrder(updated);
          toast(`Status: ${STATUS[sel.value]}`);
          route();
        } catch (e) {
          toast(e.message);
        }
      })
    );
  }

  /* ================= Calendário de prazos ================= */
  function renderCalendar(root) {
    const m = state.calMonth;
    const year = m.getFullYear(), month = m.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const today = TODAY();
    const byDay = {};
    for (const o of state.orders) {
      if (!o.due_date || o.status === 'cancelado') continue;
      (byDay[o.due_date] ||= []).push(o);
    }
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && d.getMonth() !== month) break;
      const iso = localISO(d);
      const evs = byDay[iso] || [];
      cells += `<div class="day ${d.getMonth() !== month ? 'out' : ''} ${iso === today ? 'today' : ''} ${iso < today ? 'past' : ''}">
        <span class="num">${d.getDate()}</span>
        ${evs.map((o) => `<button class="ev s-${o.status} ${isLate(o) ? 'late' : ''}" data-open="${o.id}" title="${esc(o.customer_name)} · ${STATUS[o.status]}">${esc(o.customer_name.split(' ')[0])}</button>`).join('')}
      </div>`;
    }

    const active = state.orders.filter((o) => ACTIVE.includes(o.status));
    const late = active.filter(isLate).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const noDue = active.filter((o) => !o.due_date);

    root.innerHTML = `
      <section class="card">
        <div class="cal-head">
          <h2>${first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
          <div class="cal-nav">
            <button class="btn btn-ghost btn-sm" data-m="-1" aria-label="Mês anterior">‹</button>
            <button class="btn btn-ghost btn-sm" data-m="0">Hoje</button>
            <button class="btn btn-ghost btn-sm" data-m="1" aria-label="Próximo mês">›</button>
          </div>
        </div>
        <div class="cal">
          ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => `<div class="dow">${d}</div>`).join('')}
          ${cells}
        </div>
        <div class="legend-row">${Object.keys(STATUS).filter((s) => s !== 'cancelado').map(statusPill).join('')}<span class="pill d-late">borda vermelha = atrasada</span></div>
      </section>

      <div class="cal-side">
        <section class="card">
          <h2>Atrasadas <small>${late.length}</small></h2>
          <div class="list">${late.length ? late.map(miniRow).join('') : '<div class="empty">Nada atrasado 🎉</div>'}</div>
        </section>
        <section class="card">
          <h2>Sem prazo definido <small>${noDue.length}</small></h2>
          <div class="list">${noDue.length ? noDue.map(miniRow).join('') : '<div class="empty">Todas têm prazo ✿</div>'}</div>
        </section>
      </div>`;

    $$('[data-m]', root).forEach((b) =>
      b.addEventListener('click', () => {
        const d = Number(b.dataset.m);
        state.calMonth = d === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(year, month + d, 1);
        renderCalendar(root);
      })
    );
    bindListClicks(root);
  }

  const miniRow = (o) => `
    <div class="li" data-open="${o.id}" tabindex="0">
      <div class="who">${esc(o.customer_name)}</div>
      <div class="what">${esc(o.description)}</div>
      <div class="right">${deadlineBadge(o)}${statusPill(o.status)}</div>
    </div>`;

  /* ================= Dialog de encomenda ================= */
  const odDlg = $('#orderDlg');
  const odForm = $('#orderForm');
  let editingId = null;

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  function openOrder(id) {
    const o = id ? state.orders.find((x) => x.id === id) : null;
    editingId = o ? o.id : null;
    odForm.reset();
    $('.err', odForm).hidden = true;
    $('#odTitle').textContent = o ? o.customer_name : 'Nova encomenda';
    $('#odCode').textContent = o ? `${o.code} · ${o.source === 'site' ? 'pelo site' : 'cadastro manual'}` : 'cadastro manual (ex.: pedido pelo Instagram)';
    $('#odDelete').hidden = !o;

    const fields = ['customer_name', 'phone', 'email', 'category', 'quantity', 'status', 'description', 'colors', 'size', 'desired_date', 'due_date', 'total_value', 'paid_value', 'notes'];
    for (const k of fields) {
      const el = odForm.elements[k];
      if (!el) continue;
      let v = o ? o[k] : '';
      if ((k === 'total_value' || k === 'paid_value') && o) v = o[k] ? o[k] : '';
      el.value = v ?? '';
    }
    if (!o) { odForm.elements.status.value = 'orcamento'; odForm.elements.quantity.value = 1; odForm.elements.category.value = 'bordado'; }

    const ref = $('#odRef');
    const refs = [];
    if (o?.reference_image) refs.push(`<a href="${esc(o.reference_image)}" target="_blank" rel="noopener"><img src="${esc(o.reference_image)}" alt="Referência enviada"></a><div><small class="muted">Foto de referência enviada pela cliente</small><br><a href="${esc(o.reference_image)}" target="_blank" rel="noopener">abrir em tamanho grande</a></div>`);
    if (o?.work_title) refs.push(`<img src="${esc(o.work_image)}" alt=""><div><small class="muted">Quer uma peça parecida com</small><br><b>${esc(o.work_title)}</b></div>`);
    ref.innerHTML = refs.join('<span class="spacer"></span>');
    ref.hidden = !refs.length;

    $('#odMeta').textContent = o
      ? `Recebida em ${new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}${o.paid_at ? ` · quitada em ${new Date(o.paid_at.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')}` : ''}`
      : '';
    updatePayBox();
    updateWhats();
    odDlg.showModal();
    if (!o) odForm.elements.customer_name.focus();
  }

  function updatePayBox() {
    const t = Number(odForm.elements.total_value.value) || 0;
    const p = Number(odForm.elements.paid_value.value) || 0;
    const box = $('#odPayBox');
    if (!t) {
      box.innerHTML = '<span class="muted">Defina o valor total para controlar o pagamento.</span>';
      return;
    }
    const falta = Math.max(0, t - p);
    const pseudo = { total_value: t, paid_value: p };
    box.innerHTML = `${payPill(pseudo)} <span>Recebido <b class="money">${brl(p)}</b> de <b class="money">${brl(t)}</b></span>
      ${falta > 0 ? `<span>· falta <b class="money">${brl(falta)}</b></span><span class="spacer"></span><button type="button" class="btn btn-ok btn-sm" id="odPayAll">💰 Marcar como pago</button>` : ''}`;
    const btn = $('#odPayAll');
    if (btn) btn.addEventListener('click', () => { odForm.elements.paid_value.value = t.toFixed(2); updatePayBox(); });
  }
  odForm.elements.total_value.addEventListener('input', updatePayBox);
  odForm.elements.paid_value.addEventListener('input', updatePayBox);
  $('#odHalf').addEventListener('click', () => {
    const t = Number(odForm.elements.total_value.value) || 0;
    if (!t) return toast('Preencha o valor total primeiro.');
    odForm.elements.paid_value.value = (Math.round(t * 50) / 100).toFixed(2);
    updatePayBox();
  });

  function updateWhats() {
    const a = $('#odWhats');
    const name = odForm.elements.customer_name.value.split(' ')[0];
    const code = state.orders.find((x) => x.id === editingId)?.code || '';
    const link = waLink(odForm.elements.phone.value, `Olá ${name}! Aqui é da ${state.settings.brand_name || 'Bem Bordado'}${code ? ` sobre sua encomenda ${code}` : ''} 🧵`);
    a.hidden = !link;
    if (link) a.href = link;
  }
  odForm.elements.phone.addEventListener('input', updateWhats);

  odForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err', odForm);
    err.hidden = true;
    const el = odForm.elements;
    const body = {};
    for (const k of ['customer_name', 'phone', 'email', 'category', 'quantity', 'status', 'description', 'colors', 'size', 'desired_date', 'due_date', 'total_value', 'paid_value', 'notes']) {
      body[k] = el[k].value;
    }
    if (Number(body.paid_value) > Number(body.total_value) && Number(body.total_value) > 0) {
      err.textContent = 'O valor recebido está maior que o total.';
      err.hidden = false;
      return;
    }
    if (['producao', 'pronto'].includes(body.status) && !body.due_date && !confirm('Essa encomenda está sem prazo de entrega. Salvar mesmo assim?')) return;
    try {
      const saved = editingId
        ? await api(`/api/admin/orders/${editingId}`, { method: 'PATCH', body })
        : await api('/api/admin/orders', { method: 'POST', body });
      replaceOrder(saved);
      odDlg.close();
      toast(editingId ? 'Encomenda salva ✓' : 'Encomenda criada ✓');
      route();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#odDelete').addEventListener('click', async () => {
    const o = state.orders.find((x) => x.id === editingId);
    if (!o || !confirm(`Excluir definitivamente a encomenda ${o.code} de ${o.customer_name}?\n\nDica: se ela só desistiu, prefira mudar o status para "Cancelada".`)) return;
    try {
      await api(`/api/admin/orders/${o.id}`, { method: 'DELETE' });
      state.orders = state.orders.filter((x) => x.id !== o.id);
      updateBadges();
      odDlg.close();
      toast('Encomenda excluída.');
      route();
    } catch (e) {
      toast(e.message);
    }
  });

  $('#newOrderBtn').addEventListener('click', () => openOrder(null));

  /* ================= Trabalhos (portfólio) ================= */
  const wDlg = $('#workDlg');
  const wForm = $('#workForm');
  let editingWork = null;

  function renderWorks(root) {
    root.innerHTML = `
      <div class="toolbar">
        <p class="muted" style="margin:0;flex:1">Esses trabalhos aparecem na galeria do site. Fotos quadradas ficam mais bonitas.</p>
        <button class="btn" id="newWork">+ Novo trabalho</button>
      </div>
      <div class="works">
        ${state.works.length ? state.works.map((w) => `
          <article class="wcard">
            <img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy">
            <div class="wbody">
              <div class="wtitle">${w.featured ? '<span class="star" title="Destaque">★</span> ' : ''}${esc(w.title)}</div>
              <div class="wmeta">${esc(CAT[w.category] || w.category)}${w.price_from ? ` · a partir de ${brl(w.price_from)}` : ''}</div>
            </div>
            <div class="wactions">
              <button class="btn btn-ghost btn-sm" data-edit="${w.id}">Editar</button>
              <button class="btn btn-danger-ghost btn-sm" data-del="${w.id}" aria-label="Excluir ${esc(w.title)}">Excluir</button>
            </div>
          </article>`).join('') : '<div class="card empty">Nenhum trabalho ainda. Que tal postar o primeiro?</div>'}
      </div>`;
    $('#newWork').addEventListener('click', () => openWork(null));
    $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => openWork(Number(b.dataset.edit))));
    $$('[data-del]', root).forEach((b) =>
      b.addEventListener('click', async () => {
        const w = state.works.find((x) => x.id === Number(b.dataset.del));
        if (!w || !confirm(`Excluir “${w.title}” da galeria?`)) return;
        try {
          await api(`/api/admin/works/${w.id}`, { method: 'DELETE' });
          state.works = state.works.filter((x) => x.id !== w.id);
          toast('Trabalho removido.');
          renderWorks(root);
        } catch (e) {
          toast(e.message);
        }
      })
    );
  }

  function openWork(id) {
    const w = id ? state.works.find((x) => x.id === id) : null;
    editingWork = w;
    wForm.reset();
    $('.err', wForm).hidden = true;
    $('#wdTitle').textContent = w ? 'Editar trabalho' : 'Novo trabalho';
    const img = $('#wdUpload img');
    img.hidden = !w;
    if (w) img.src = w.image;
    $('#wdUpload span').textContent = w ? '📷 Trocar foto' : '📷 Escolher foto';
    if (w) {
      wForm.title.value = w.title;
      wForm.category.value = w.category;
      wForm.price_from.value = w.price_from ?? '';
      wForm.description.value = w.description || '';
      wForm.featured.checked = !!w.featured;
    }
    wDlg.showModal();
  }

  wForm.imagem.addEventListener('change', () => {
    const f = wForm.imagem.files[0];
    const img = $('#wdUpload img');
    if (!f) return;
    img.src = URL.createObjectURL(f);
    img.hidden = false;
  });

  wForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err', wForm);
    err.hidden = true;
    const fd = new FormData(wForm);
    fd.set('featured', wForm.featured.checked ? '1' : '0');
    if (!wForm.imagem.files.length) fd.delete('imagem');
    const btn = $('button[type="submit"]', wForm);
    btn.disabled = true;
    try {
      const saved = editingWork
        ? await api(`/api/admin/works/${editingWork.id}`, { method: 'PATCH', body: fd })
        : await api('/api/admin/works', { method: 'POST', body: fd });
      const i = state.works.findIndex((x) => x.id === saved.id);
      if (i >= 0) state.works[i] = saved;
      else state.works.unshift(saved);
      state.works.sort((a, b) => b.featured - a.featured || b.id - a.id);
      wDlg.close();
      toast('Trabalho salvo ✓');
      route();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* ================= Configurações ================= */
  function renderSettings(root) {
    const s = state.settings;
    root.innerHTML = `
      <div class="cfg">
        <form class="card" id="siteForm">
          <h2>Informações do site</h2>
          <div class="g2">
            <label class="f"><span>Nome do ateliê</span><input name="brand_name" maxlength="60" value="${esc(s.brand_name)}"></label>
            <label class="f"><span>Instagram</span><input name="instagram" maxlength="60" value="${esc(s.instagram)}" placeholder="bembordado_"></label>
          </div>
          <div class="g2">
            <label class="f"><span>WhatsApp (com DDD)</span><input name="whatsapp" maxlength="30" value="${esc(s.whatsapp)}" placeholder="5511999999999" inputmode="tel"></label>
            <label class="f"><span>E-mail de contato</span><input name="email" type="email" maxlength="120" value="${esc(s.email)}"></label>
          </div>
          <p class="hint-text">O WhatsApp ativa o botão verde do site. Use o formato com código do país: 55 + DDD + número.</p>
          <label class="f"><span>Texto “Sobre o ateliê”</span><textarea name="about" rows="5" maxlength="2000">${esc(s.about)}</textarea></label>
          <label class="f"><span>Aviso de prazo (aparece em “Como funciona”)</span><input name="lead_time" maxlength="200" value="${esc(s.lead_time)}"></label>
          <button class="btn" type="submit">Salvar informações</button>
        </form>

        <form class="card" id="pwForm" autocomplete="off">
          <h2>Acesso ao painel</h2>
          <label class="f"><span>Usuário</span><input name="username" value="${esc(state.user?.username)}" autocomplete="username" minlength="3" maxlength="60"></label>
          <label class="f"><span>Senha atual *</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="f"><span>Nova senha</span><input name="next" type="password" autocomplete="new-password" minlength="8" placeholder="mínimo 8 caracteres"></label>
          <label class="f"><span>Repita a nova senha</span><input name="next2" type="password" autocomplete="new-password"></label>
          <p class="err" hidden></p>
          <button class="btn" type="submit">Atualizar acesso</button>
        </form>
      </div>`;

    $('#siteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        state.settings = await api('/api/admin/settings', { method: 'PUT', body });
        $('#sideBrand').textContent = state.settings.brand_name || 'Bem Bordado';
        toast('Informações salvas ✓');
        renderSettings(root);
      } catch (ex) {
        toast(ex.message);
      }
    });

    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = $('.err', f);
      err.hidden = true;
      if (f.next.value !== f.next2.value) {
        err.textContent = 'As novas senhas não conferem.';
        err.hidden = false;
        return;
      }
      try {
        const r = await api('/api/admin/password', { method: 'POST', body: { username: f.username.value, current: f.current.value, next: f.next.value } });
        state.user = { username: r.username };
        toast('Acesso atualizado ✓');
        renderSettings(root);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  boot();
})();
