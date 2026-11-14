const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Fingerprint of the password hash: changing the password invalidates old sessions.
function passwordVersion(hash) {
  return crypto.createHash('sha256').update(hash).digest('base64url').slice(0, 12);
}

function createSessions(secret, ttlMs = 1000 * 60 * 60 * 12) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  function issue(user) {
    const payload = Buffer.from(
      JSON.stringify({ uid: user.id, pv: passwordVersion(user.password_hash), exp: Date.now() + ttlMs })
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function read(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!data.exp || data.exp < Date.now()) return null;
      return data;
    } catch {
      return null;
    }
  }

  return { issue, read, ttlMs };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { hashPassword, verifyPassword, passwordVersion, createSessions, parseCookies };
