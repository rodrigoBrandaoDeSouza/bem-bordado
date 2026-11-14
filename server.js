const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { db, getSetting, setSetting, UPLOAD_DIR } = require('./src/db');
const {
  hashPassword,
  verifyPassword,
  passwordVersion,
  createSessions,
  parseCookies,
} = require('./src/auth');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'bb_session';

const CATEGORIES = ['bordado', 'croche', 'bordado-croche', 'outro'];
const STATUSES = ['novo', 'orcamento', 'producao', 'pronto', 'entregue', 'cancelado'];

/* ------------------------------------------------------------------ */
/* Bootstrap: secret, admin user, default settings, sample works       */
/* ------------------------------------------------------------------ */

let secret = process.env.SESSION_SECRET || getSetting('session_secret');
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', secret);
}
const sessions = createSessions(secret);

if (!db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || 'bembordado';
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(user, hashPassword(pass));
  // A senha só aparece no log quando é a padrão de desenvolvimento; a definida por ADMIN_PASS nunca é registrada.
  console.log(`\n  Usuário admin criado: "${user}"${process.env.ADMIN_PASS ? ' (senha definida em ADMIN_PASS)' : ` / senha "${pass}"`}`);
  console.log('  Troque a senha em Painel > Configurações assim que entrar.\n');
}

const DEFAULT_SETTINGS = {
  brand_name: 'Bem Bordado',
  instagram: 'bembordado_',
  whatsapp: '',
  email: '',
  about:
    'Cada peça nasce devagar, ponto por ponto, entre linhas, agulhas e muito carinho. ' +
    'Faço bordados livres, peças em crochê e presentes personalizados que guardam histórias — ' +
    'nomes, datas, flores e memórias que merecem ficar para sempre.',
  lead_time: 'Prazo médio de produção: 15 a 30 dias, conforme a peça.',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k) === undefined) setSetting(k, v);
}

if (!db.prepare('SELECT COUNT(*) AS n FROM works').get().n && getSetting('samples_seeded') !== '1') {
  const samples = [
    ['Bastidor floral', 'bordado', 'Bordado livre com flores do campo em linha de algodão.', '/img/amostras/amostra-1.svg', 120, 1],
    ['Nome do bebê', 'bordado', 'Bastidor personalizado para porta de maternidade.', '/img/amostras/amostra-2.svg', 150, 1],
    ['Square vintage', 'croche', 'Manta montada com quadradinhos (granny squares).', '/img/amostras/amostra-3.svg', 380, 0],
    ['Ramalhete de lavanda', 'bordado', 'Bordado delicado em tons de lilás e verde-oliva.', '/img/amostras/amostra-4.svg', 110, 0],
    ['Bolsinha de crochê', 'croche', 'Bolsa pequena em fio de algodão com alça de madeira.', '/img/amostras/amostra-5.svg', 140, 1],
    ['Bastidor de família', 'bordado-croche', 'Bastidor bordado com barrado de crochê ao redor.', '/img/amostras/amostra-6.svg', 190, 0],
  ];
  const ins = db.prepare(
    'INSERT INTO works (title, category, description, image, price_from, featured) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of samples) ins.run(...s);
  setSetting('samples_seeded', '1');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '200kb' }));

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(new HttpError(400, 'Envie uma imagem JPG, PNG, WEBP ou GIF.'));
  },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const money = (v) => {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new HttpError(400, 'Valor inválido.');
  return Math.round(n * 100) / 100;
};
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  fs.promises.unlink(file).catch(() => {});
}

function newOrderCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let code = 'BB-';
    for (const b of bytes) code += alphabet[b % alphabet.length];
    if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
  }
}

// Very small in-memory rate limiter (per IP + bucket).
const hits = new Map();
function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const t = Date.now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    arr.push(t);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => {
  const t = Date.now();
  for (const [k, arr] of hits) if (!arr.some((x) => t - x < 60 * 60 * 1000)) hits.delete(k);
}, 10 * 60 * 1000).unref();

function setSessionCookie(res, token, maxAgeMs) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req, res, next) {
  const data = sessions.read(parseCookies(req.headers.cookie)[COOKIE]);
  if (!data) return res.status(401).json({ error: 'Faça login para continuar.' });
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(data.uid);
  if (!user || passwordVersion(user.password_hash) !== data.pv) {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
  req.user = { id: user.id, username: user.username };
  next();
}

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

function publicSettings() {
  return {
    brand_name: getSetting('brand_name'),
    instagram: getSetting('instagram'),
    whatsapp: getSetting('whatsapp'),
    email: getSetting('email'),
    about: getSetting('about'),
    lead_time: getSetting('lead_time'),
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/settings', (req, res) => res.json(publicSettings()));

app.get('/api/works', (req, res) => {
  const rows = db
    .prepare('SELECT id, title, category, description, image, price_from, featured FROM works ORDER BY featured DESC, id DESC')
    .all();
  res.json(rows);
});

app.post(
  '/api/orders',
  rateLimit('order', 8, 60 * 60 * 1000),
  upload.single('referencia'),
  wrap((req, res) => {
    const b = req.body || {};
    try {
      // Honeypot: real visitors never fill this hidden field.
      if (str(b.website)) return res.json({ ok: true, code: 'BB-OBRIGADA' });

      const name = str(b.nome, 100);
      const phone = str(b.whatsapp, 30);
      const email = str(b.email, 120);
      const category = str(b.categoria, 30);
      const description = str(b.descricao, 2000);
      const colors = str(b.cores, 200);
      const size = str(b.tamanho, 100);
      const quantity = Math.max(1, Math.min(999, parseInt(b.quantidade, 10) || 1));
      const desired = str(b.data_desejada, 10);
      const workId = parseInt(b.work_id, 10) || null;

      if (name.length < 2) throw new HttpError(400, 'Conte seu nome, por favor.');
      if (phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Informe um WhatsApp com DDD.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
      if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Escolha o tipo de peça.');
      if (description.length < 5) throw new HttpError(400, 'Descreva um pouquinho a sua ideia.');
      if (desired && !isDate(desired)) throw new HttpError(400, 'Data desejada inválida.');

      const code = newOrderCode();
      const image = req.file ? `/uploads/${req.file.filename}` : null;
      db.prepare(
        `INSERT INTO orders (code, customer_name, phone, email, category, description, quantity, colors, size,
           desired_date, due_date, reference_image, work_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site')`
      ).run(code, name, phone, email, category, description, quantity, colors, size,
        desired || null, desired || null, image, workId);

      res.status(201).json({ ok: true, code });
    } catch (e) {
      if (req.file) removeUpload(`/uploads/${req.file.filename}`);
      throw e;
    }
  })
);

app.get('/api/orders/track/:code', rateLimit('track', 30, 10 * 60 * 1000), (req, res) => {
  const code = str(req.params.code, 20).toUpperCase();
  const o = db
    .prepare('SELECT code, status, category, due_date, created_at FROM orders WHERE code = ?')
    .get(code);
  if (!o) return res.status(404).json({ error: 'Não encontramos uma encomenda com esse código.' });
  res.json(o);
});

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

app.post('/api/admin/login', rateLimit('login', 10, 15 * 60 * 1000), (req, res) => {
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password ?? '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  setSessionCookie(res, sessions.issue(user), sessions.ttlMs);
  res.json({ ok: true, username: user.username });
});

app.post('/api/admin/logout', (req, res) => {
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => res.json(req.user));

app.post('/api/admin/password', requireAuth, (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  const newUsername = str(req.body?.username, 60);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, user.password_hash)) {
    return res.status(400).json({ error: 'A senha atual não confere.' });
  }
  if (next && next.length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  if (newUsername && newUsername.length < 3) return res.status(400).json({ error: 'Usuário muito curto.' });
  const hash = next ? hashPassword(next) : user.password_hash;
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(newUsername || user.username, hash, user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  setSessionCookie(res, sessions.issue(updated), sessions.ttlMs);
  res.json({ ok: true, username: updated.username });
});

/* ------------------------------------------------------------------ */
/* Admin: orders                                                      */
/* ------------------------------------------------------------------ */

const admin = express.Router();
admin.use(requireAuth);

admin.get('/orders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, w.title AS work_title, w.image AS work_image
       FROM orders o LEFT JOIN works w ON w.id = o.work_id
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json(rows);
});

function readOrderFields(b, partial) {
  const f = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has('customer_name')) {
    f.customer_name = str(b.customer_name, 100);
    if (f.customer_name.length < 2) throw new HttpError(400, 'Nome da cliente é obrigatório.');
  }
  if (!partial || has('phone')) f.phone = str(b.phone, 30);
  if (has('email')) f.email = str(b.email, 120);
  if (!partial || has('category')) {
    f.category = str(b.category, 30) || 'outro';
    if (!CATEGORIES.includes(f.category)) throw new HttpError(400, 'Categoria inválida.');
  }
  if (!partial || has('description')) {
    f.description = str(b.description, 2000);
    if (!f.description) throw new HttpError(400, 'Descreva a encomenda.');
  }
  if (has('quantity')) f.quantity = Math.max(1, Math.min(999, parseInt(b.quantity, 10) || 1));
  if (has('colors')) f.colors = str(b.colors, 200);
  if (has('size')) f.size = str(b.size, 100);
  for (const k of ['desired_date', 'due_date']) {
    if (has(k)) {
      const v = str(b[k], 10);
      if (v && !isDate(v)) throw new HttpError(400, 'Data inválida.');
      f[k] = v || null;
    }
  }
  if (has('status')) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Status inválido.');
    f.status = b.status;
  }
  if (has('total_value')) f.total_value = money(b.total_value);
  if (has('paid_value')) f.paid_value = money(b.paid_value);
  if (has('notes')) f.notes = str(b.notes, 4000);
  return f;
}

admin.post('/orders', wrap((req, res) => {
  const f = readOrderFields(req.body || {}, false);
  f.code = newOrderCode();
  f.source = 'manual';
  if (f.paid_value > 0 && f.paid_value >= (f.total_value || 0)) f.paid_at = now();
  const keys = Object.keys(f);
  const info = db
    .prepare(`INSERT INTO orders (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => f[k]));
  res.status(201).json(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
}));

admin.patch('/orders/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Encomenda não encontrada.');
  const f = readOrderFields(req.body || {}, true);
  const total = f.total_value ?? current.total_value;
  const paid = f.paid_value ?? current.paid_value;
  if (total > 0 && paid >= total) f.paid_at = current.paid_at || now();
  else f.paid_at = null;
  f.updated_at = now();
  const keys = Object.keys(f);
  db.prepare(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => f[k]),
    id
  );
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}));

admin.post('/orders/:id/pay', wrap((req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'Encomenda não encontrada.');
  if (!(o.total_value > 0)) throw new HttpError(400, 'Defina o valor da encomenda antes de marcar como paga.');
  db.prepare('UPDATE orders SET paid_value = total_value, paid_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}));

admin.delete('/orders/:id', wrap((req, res) => {
  const o = db.prepare('SELECT reference_image FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Encomenda não encontrada.');
  db.prepare('DELETE FROM orders WHERE id = ?').run(Number(req.params.id));
  removeUpload(o.reference_image);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Admin: works (portfólio)                                           */
/* ------------------------------------------------------------------ */

admin.get('/works', (req, res) => {
  res.json(db.prepare('SELECT * FROM works ORDER BY featured DESC, id DESC').all());
});

admin.post('/works', upload.single('imagem'), wrap((req, res) => {
  try {
    const b = req.body || {};
    const title = str(b.title, 120);
    const category = str(b.category, 30);
    if (!req.file) throw new HttpError(400, 'Escolha uma foto do trabalho.');
    if (!title) throw new HttpError(400, 'Dê um título ao trabalho.');
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Categoria inválida.');
    const price = b.price_from === '' || b.price_from == null ? null : money(b.price_from);
    const info = db
      .prepare('INSERT INTO works (title, category, description, image, price_from, featured) VALUES (?, ?, ?, ?, ?, ?)')
      .run(title, category, str(b.description, 1000), `/uploads/${req.file.filename}`, price, b.featured === '1' ? 1 : 0);
    res.status(201).json(db.prepare('SELECT * FROM works WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw e;
  }
}));

admin.patch('/works/:id', upload.single('imagem'), wrap((req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(id);
  if (!w) throw new HttpError(404, 'Trabalho não encontrado.');
  const b = req.body || {};
  const category = b.category != null ? str(b.category, 30) : w.category;
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Categoria inválida.');
  const price = b.price_from === undefined ? w.price_from : b.price_from === '' ? null : money(b.price_from);
  const image = req.file ? `/uploads/${req.file.filename}` : w.image;
  db.prepare('UPDATE works SET title = ?, category = ?, description = ?, image = ?, price_from = ?, featured = ? WHERE id = ?').run(
    b.title != null ? str(b.title, 120) || w.title : w.title,
    category,
    b.description != null ? str(b.description, 1000) : w.description,
    image,
    price,
    b.featured != null ? (b.featured === '1' || b.featured === true ? 1 : 0) : w.featured,
    id
  );
  if (req.file) removeUpload(w.image);
  res.json(db.prepare('SELECT * FROM works WHERE id = ?').get(id));
}));

admin.delete('/works/:id', wrap((req, res) => {
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(Number(req.params.id));
  if (!w) throw new HttpError(404, 'Trabalho não encontrado.');
  db.prepare('UPDATE orders SET work_id = NULL WHERE work_id = ?').run(w.id);
  db.prepare('DELETE FROM works WHERE id = ?').run(w.id);
  removeUpload(w.image);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Admin: settings                                                    */
/* ------------------------------------------------------------------ */

admin.get('/settings', (req, res) => res.json(publicSettings()));

admin.put('/settings', (req, res) => {
  const b = req.body || {};
  const limits = { brand_name: 60, instagram: 60, whatsapp: 30, email: 120, about: 2000, lead_time: 200 };
  for (const [k, max] of Object.entries(limits)) {
    if (b[k] !== undefined) {
      let v = str(b[k], max);
      if (k === 'instagram') v = v.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
      if (k === 'whatsapp') v = v.replace(/\D/g, '');
      setSetting(k, v);
    }
  }
  res.json(publicSettings());
});

app.use('/api/admin', admin);

/* ------------------------------------------------------------------ */
/* Static + errors                                                    */
/* ------------------------------------------------------------------ */

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A imagem pode ter no máximo 6 MB.' : 'Erro no envio da imagem.';
    return res.status(400).json({ error: msg });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Ops! Algo deu errado. Tente novamente.' });
});

app.listen(PORT, () => {
  console.log(`  Bem Bordado rodando em http://localhost:${PORT}`);
  console.log(`  Painel admin:         http://localhost:${PORT}/admin\n`);
});
