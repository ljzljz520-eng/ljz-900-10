'use strict';
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const KEY_FILE = path.join(__dirname, '..', 'data', '.secret');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 管理/老板端会话 12 小时

function getSecret() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}
const SECRET = getSecret();
const sessions = new Map(); // sid -> { role, userId, exp }

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/**
 * 员工链接 token：emp.<empId>.<version>.<exp>.<sig>
 * version 变化（管理员重置链接）或过期都会失效。
 */
function makeEmployeeToken(empId, version, exp) {
  const payload = `emp.${empId}.${version}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyEmployeeToken(token) {
  if (typeof token !== 'string' || !token.startsWith('emp.')) {
    return { ok: false, code: 'INVALID_TOKEN', message: '链接格式不正确，请向管理员重新索取二维码。' };
  }
  const parts = token.split('.');
  if (parts.length !== 5) {
    return { ok: false, code: 'INVALID_TOKEN', message: '链接格式不正确，请向管理员重新索取二维码。' };
  }
  const [, empId, versionStr, expStr, sig] = parts;
  const payload = `emp.${empId}.${versionStr}.${expStr}`;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'INVALID_TOKEN', message: '链接签名校验失败（链接可能被篡改或不完整），请扫描原始二维码。' };
  }
  const exp = Number(expStr);
  const now = Date.now();
  if (!Number.isFinite(exp)) {
    return { ok: false, code: 'INVALID_TOKEN', message: '链接信息无效，请向管理员重新索取二维码。' };
  }
  if (exp <= now) {
    return {
      ok: false,
      code: 'EXPIRED',
      expiredAt: new Date(exp).toISOString(),
      message: `该整改链接已于 ${formatDate(exp)} 过期，请联系甲方管理员重新生成二维码。`
    };
  }
  return { ok: true, empId, version: Number(versionStr), exp };
}

function formatDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- 管理端 / 老板端会话（cookie） ----
function createSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { role: user.role, userId: user.id, exp: Date.now() + SESSION_TTL_MS });
  return sid;
}

function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.exp <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

function destroySession(sid) {
  if (sid) sessions.delete(sid);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

module.exports = {
  makeEmployeeToken,
  verifyEmployeeToken,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  formatDate
};
