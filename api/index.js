'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');

const users = new Map();
const pastes = new Map();
const shortUrls = new Map();
const uploads = new Map();
const attempts = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function send(res, status, payload) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(payload)); }
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization'); }
function ok(res, data, status = 200) { return send(res, status, { status, data }); }
function fail(res, status, message, details) { return send(res, status, { status, error: message, ...(details ? { details } : {}) }); }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 2_000_000) reject(new Error('Request body too large')); }); req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body must be valid JSON')); } }); req.on('error', reject); }); }
function publicUser(u) { return { id: u.id, email: u.email, name: u.name, created_at: u.created_at }; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function matchesPassword(password, stored) { const [salt, expected] = String(stored).split(':'); if (!salt || !expected) return false; const actual = crypto.scryptSync(password, salt, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); }
function tokenFor(userId) { const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const payload = b64(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })); const unsigned = `${header}.${payload}`; const sig = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url'); return `${unsigned}.${sig}`; }
function userFromToken(header) { const token = String(header || '').startsWith('Bearer ') ? String(header).slice(7) : ''; const [h, p, sig] = token.split('.'); if (!h || !p || !sig) return null; const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url'); if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; try { const claims = JSON.parse(Buffer.from(p, 'base64url').toString()); return claims.exp > Date.now() / 1000 ? users.get(claims.sub) || null : null; } catch { return null; } }
function requireAuth(req, res) { const user = userFromToken(req.headers.authorization); if (!user) { fail(res, 401, 'Authentication required. Use a bearer token from /auth/register or /auth/login.'); return null; } return user; }
function rateLimit(req, res) { const key = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local'; const e = attempts.get(key) || { count: 0, reset: Date.now() + 60_000 }; if (Date.now() > e.reset) { e.count = 0; e.reset = Date.now() + 60_000; } e.count++; attempts.set(key, e); if (e.count > 120) { fail(res, 429, 'Too many requests'); return false; } return true; }
function missing(res, name) { return fail(res, 400, `Missing: ${name}`, { field: name }); }
function unsupported(res, feature, reason = 'This feature requires remote source data or a model service. No third-party endpoints are configured.') { return fail(res, 501, `${feature} is not available in self-contained mode. ${reason}`); }
function parseYouTubeId(url) { return String(url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/|\/v\/)([A-Za-z0-9_-]{6,})/)?.[1] || null; }

module.exports = async function handler(req, res) {
  cors(res); if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); } if (!rateLimit(req, res)) return;
  const parsed = new URL(req.url || '/', 'http://localhost'); const route = parsed.pathname.replace(/\/$/, '') || '/'; const q = parsed.searchParams;
  try {
    if (req.method === 'GET' && (route === '/' || route === '/status')) return ok(res, { status: 'online', name: 'Black Node ZW API', version: '3.0.0', self_contained: true, third_party_endpoints: false, authentication: 'bearer', native_endpoints: ['/qrcode/generate', '/random/password', '/random/uuid', '/random/color', '/email/validate', '/paste/create', '/paste/:id', '/url/shorten', '/s/:alias', '/auth/register', '/auth/login'] });

    if (req.method === 'POST' && (route === '/auth/register' || route === '/v1/auth/register')) { const body = await readBody(req); const email = cleanEmail(body.email); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'A valid email is required'); if (typeof body.password !== 'string' || body.password.length < 8) return fail(res, 400, 'Password must be at least 8 characters'); if (users.has(email)) return fail(res, 409, 'An account with that email already exists'); const user = { id: id(), email, name: String(body.name || email.split('@')[0]).trim().slice(0, 80), password_hash: hashPassword(body.password), created_at: now() }; users.set(user.id, user); users.set(email, user); return ok(res, { user: publicUser(user), token: tokenFor(user.id), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS }, 201); }
    if (req.method === 'POST' && (route === '/auth/login' || route === '/v1/auth/login')) { const body = await readBody(req); const user = users.get(cleanEmail(body.email)); if (!user || !matchesPassword(body.password, user.password_hash)) return fail(res, 401, 'Invalid email or password'); return ok(res, { user: publicUser(user), token: tokenFor(user.id), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS }); }
    if (req.method === 'GET' && (route === '/me' || route === '/v1/me')) { const user = requireAuth(req, res); if (user) return ok(res, { user: publicUser(user) }); }

    if (req.method === 'GET' && route === '/qrcode/generate') { const text = q.get('text') || q.get('data'); if (!text) return missing(res, 'text'); const svg = await QRCode.toString(text, { type: 'svg', margin: 2, width: Number(q.get('size') || 300) }); return ok(res, { text, format: 'svg', qr_code: svg }); }
    if (req.method === 'GET' && route === '/random/password') { const length = Math.min(Math.max(Number(q.get('length') || 16), 8), 128); const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'; return ok(res, { password: Array.from(crypto.randomBytes(length), b => alphabet[b % alphabet.length]).join(''), length }); }
    if (req.method === 'GET' && route === '/random/uuid') return ok(res, { uuid: id() });
    if (req.method === 'GET' && route === '/random/color') { const hex = `#${crypto.randomBytes(3).toString('hex')}`; return ok(res, { hex, rgb: { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) } }); }
    if (req.method === 'GET' && route === '/email/validate') { const email = cleanEmail(q.get('email')); const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email); return ok(res, { email, valid, checks: { syntax: valid, disposable: null, mailbox: null, smtp: null }, note: 'Only local syntax validation is performed without external services.' }); }
    if (req.method === 'GET' && route === '/country') { const country = String(q.get('name') || q.get('code') || '').trim(); if (!country) return missing(res, 'name'); const local = { ZW: { name: 'Zimbabwe', code: 'ZW', currency: 'ZWL', capital: 'Harare', region: 'Africa' }, ZA: { name: 'South Africa', code: 'ZA', currency: 'ZAR', capital: 'Pretoria', region: 'Africa' }, US: { name: 'United States', code: 'US', currency: 'USD', capital: 'Washington, D.C.', region: 'Americas' } }; const result = local[country.toUpperCase()] || Object.values(local).find(x => x.name.toLowerCase() === country.toLowerCase()); return result ? ok(res, result) : fail(res, 404, 'Country is not present in the local dataset'); }

    if (req.method === 'POST' && route === '/paste/create') { const body = await readBody(req); const content = typeof body.content === 'string' ? body.content : ''; if (!content) return missing(res, 'content'); const paste = { id: id().slice(0, 8), content, title: String(body.title || '').slice(0, 120), created_at: now(), expires_at: body.expires_at || null }; pastes.set(paste.id, paste); return ok(res, { id: paste.id, url: `/paste/${paste.id}`, created_at: paste.created_at, expires_at: paste.expires_at }, 201); }
    const pasteMatch = route.match(/^\/paste\/([\w-]+)$/); if (req.method === 'GET' && pasteMatch) { const paste = pastes.get(pasteMatch[1]); return paste ? ok(res, paste) : fail(res, 404, 'Paste not found'); }
    if (req.method === 'POST' && route === '/url/shorten') { const body = await readBody(req); const target = body.url || q.get('url'); try { new URL(target); } catch { return fail(res, 400, 'A valid url is required'); } const alias = id().slice(0, 8); shortUrls.set(alias, { url: target, created_at: now(), clicks: 0 }); return ok(res, { alias, url: `/s/${alias}`, target }, 201); }
    const shortMatch = route.match(/^\/s\/([\w-]+)$/); if (req.method === 'GET' && shortMatch) { const item = shortUrls.get(shortMatch[1]); if (!item) return fail(res, 404, 'Short URL not found'); item.clicks++; res.statusCode = 302; res.setHeader('Location', item.url); return res.end(); }

    if (route === '/storage/upload' || route === '/storage/delete') return unsupported(res, 'Storage');
    if (route === '/tiktok/download' || route === '/tiktok/user' || route === '/tiktok/search' || route === '/tiktok/trending' || route.startsWith('/youtube/') || route.startsWith('/instagram/') || route.startsWith('/facebook/') || route.startsWith('/twitter/') || route.startsWith('/pinterest/')) return unsupported(res, 'Social-media and video operations');
    if (route === '/weather' || route === '/news' || route === '/currency/convert' || route === '/ip/lookup' || route === '/github/user' || route === '/spotify/track' || route.startsWith('/movie/') || route === '/phone/lookup' || route === '/dictionary' || route === '/pinterest/search') return unsupported(res, 'Live-data lookup');
    if (route.startsWith('/ai/') || route === '/image/search' || route === '/image/generate' || route === '/image/removebg' || route === '/screenshot' || route === '/whatsapp/send' || route === '/whatsapp/verify' || route === '/telegram/send' || route === '/telegram/file') return unsupported(res, 'AI, image, messaging, or screenshot operation');
    if (route === '/fun') return ok(res, { quote: 'Build locally. Depend deliberately.', source: 'Black Node ZW local' });
    return fail(res, 404, 'Route not found');
  } catch (error) { return fail(res, error.message === 'Request body must be valid JSON' ? 400 : 500, error.message || 'Internal server error'); }
};
