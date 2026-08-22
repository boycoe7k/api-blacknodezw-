'use strict';

const crypto = require('node:crypto');

const users = new Map();
const items = new Map();
const attempts = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function ok(res, data, status = 200) { return send(res, status, { data }); }
function fail(res, status, message, details) { return send(res, status, { error: { message, ...(details ? { details } : {}) } }); }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function cleanEmail(email) { return String(email || '').trim().toLowerCase(); }
function publicUser(user) { return { id: user.id, email: user.email, name: user.name, created_at: user.created_at }; }

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}
function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function signToken(userId) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  if (parts[2].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return users.get(payload.sub) || null;
  } catch { return null; }
}

function auth(req, res) {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!user) { fail(res, 401, 'Authentication required. Use a bearer token from /v1/auth/login.'); return null; }
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) reject(new Error('Request body too large')); });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body must be valid JSON')); } });
    req.on('error', reject);
  });
}
function validateText(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim()) return `${field} is required`;
  if (value.trim().length > max) return `${field} must be at most ${max} characters`;
  return null;
}
function rateLimit(req, res) {
  const key = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local';
  const entry = attempts.get(key) || { count: 0, reset: Date.now() + 60000 };
  if (Date.now() > entry.reset) { entry.count = 0; entry.reset = Date.now() + 60000; }
  entry.count += 1; attempts.set(key, entry);
  if (entry.count > 60) { fail(res, 429, 'Too many requests. Try again later.'); return false; }
  return true;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.statusCode = 204, res.end();
  if (!rateLimit(req, res)) return;

  const parsed = new URL(req.url || '/', 'http://localhost');
  const path = parsed.pathname.replace(/\/+$|^\/?/g, match => match === '/' ? '/' : '');
  const route = parsed.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'GET' && (route === '/' || route === '/status')) {
    return ok(res, { name: 'Black Node ZW API', version: '2.0.0', status: 'online', self_contained: true, authentication: 'bearer', endpoints: ['/v1/auth/register', '/v1/auth/login', '/v1/me', '/v1/items'] });
  }

  try {
    if (req.method === 'POST' && route === '/v1/auth/register') {
      const body = await readBody(req);
      const email = cleanEmail(body.email);
      const emailError = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : 'A valid email is required';
      const passwordError = typeof body.password !== 'string' || body.password.length < 8 ? 'Password must be at least 8 characters' : null;
      if (emailError || passwordError) return fail(res, 400, 'Validation failed', [emailError, passwordError].filter(Boolean));
      if (users.has(email)) return fail(res, 409, 'An account with that email already exists');
      const user = { id: id(), email, name: String(body.name || email.split('@')[0]).trim().slice(0, 80), password_hash: passwordHash(body.password), created_at: now() };
      users.set(user.id, user); users.set(user.email, user);
      return ok(res, { user: publicUser(user), token: signToken(user.id), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS }, 201);
    }

    if (req.method === 'POST' && route === '/v1/auth/login') {
      const body = await readBody(req); const user = users.get(cleanEmail(body.email));
      if (!user || !passwordMatches(body.password, user.password_hash)) return fail(res, 401, 'Invalid email or password');
      return ok(res, { user: publicUser(user), token: signToken(user.id), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS });
    }

    if (route === '/v1/me') {
      const user = auth(req, res); if (!user) return;
      if (req.method === 'GET') return ok(res, { user: publicUser(user) });
    }

    if (route === '/v1/items' && req.method === 'GET') {
      const user = auth(req, res); if (!user) return;
      const owned = [...items.values()].filter(item => item.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok(res, { items: owned, total: owned.length });
    }

    const itemMatch = route.match(/^\/v1\/items\/([a-f0-9-]+)$/);
    if (route === '/v1/items' && req.method === 'POST') {
      const user = auth(req, res); if (!user) return;
      const body = await readBody(req); const titleError = validateText(body.title, 'title');
      if (titleError) return fail(res, 400, titleError);
      const item = { id: id(), user_id: user.id, title: body.title.trim(), description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '', metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}, created_at: now(), updated_at: now() };
      items.set(item.id, item); return ok(res, { item }, 201);
    }
    if (itemMatch && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
      const user = auth(req, res); if (!user) return;
      const item = items.get(itemMatch[1]); if (!item || item.user_id !== user.id) return fail(res, 404, 'Item not found');
      if (req.method === 'GET') return ok(res, { item });
      if (req.method === 'DELETE') { items.delete(item.id); return res.statusCode = 204, res.end(); }
      const body = await readBody(req);
      if (body.title !== undefined) { const error = validateText(body.title, 'title'); if (error) return fail(res, 400, error); item.title = body.title.trim(); }
      if (body.description !== undefined) item.description = String(body.description).trim().slice(0, 2000);
      if (body.metadata !== undefined && body.metadata && typeof body.metadata === 'object') item.metadata = body.metadata;
      item.updated_at = now(); return ok(res, { item });
    }
    return fail(res, 404, 'Route not found');
  } catch (error) {
    return fail(res, error.message === 'Request body must be valid JSON' ? 400 : 500, error.message || 'Internal server error');
  }
};
