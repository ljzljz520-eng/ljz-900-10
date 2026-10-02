'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const store = require('./lib/store');
const auth = require('./lib/auth');

const PORT = process.env.PORT || 3000;

// ---- 限制常量（图片过大时给出明确提示） ----
const MAX_IMG_BYTES = 5 * 1024 * 1024;   // 单张图片 5MB
const MAX_PHOTOS_PER_ISSUE = 6;
const MAX_BODY_BYTES = 12 * 1024 * 1024; // body 上限（base64 膨胀后）
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---------- 基础工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function fail(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;
    const rejectOversize = () => {
      if (rejected) return;
      rejected = true;
      const err = Object.assign(new Error('请求体过大'), {
        code: 'PAYLOAD_TOO_LARGE',
        status: 413,
        message: `提交内容超过服务器上限（${formatMB(MAX_BODY_BYTES)}）。单张图片不能超过 5MB，请压缩后重新上传。`
      });
      // 先把 413 清晰响应发出去，再排空/销毁连接，避免客户端拿到空响应
      if (res && !res.headersSent) {
        sendJson(res, 413, { error: { code: err.code, message: err.message } });
      }
      try { req.resume(); } catch {}
      req.destroy();
      reject(err);
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return rejectOversize();
    }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return rejectOversize();
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', e => { if (!rejected) reject(e); });
  });
}

async function readJson(req, res) {
  const raw = await readBody(req, res);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error('JSON 格式错误'), {
      code: 'BAD_JSON', status: 400, message: '提交的数据格式不正确，请刷新页面重试。'
    });
  }
}

function formatMB(n) {
  return `${(n / 1024 / 1024).toFixed(0)}MB`;
}

function parseCookiesSafe(req) {
  try { return auth.parseCookies(req); } catch { return {}; }
}

function getSessionUser(req) {
  const cookies = parseCookiesSafe(req);
  return auth.getSession(cookies.sid);
}

function requireRole(req, res, role) {
  const sess = getSessionUser(req);
  if (!sess) {
    fail(res, 401, 'UNAUTHORIZED', '登录已失效，请重新登录。');
    return null;
  }
  if (role && sess.role !== role) {
    fail(res, 403, 'FORBIDDEN', '无权访问该页面（当前身份没有此权限）。');
    return null;
  }
  return sess;
}

/**
 * 从 cookie 或查询参数解析员工 token。
 */
function resolveEmployee(req, res) {
  const cookies = parseCookiesSafe(req);
  const url = new URL(req.url, 'http://x');
  const token = cookies.emp_token || url.searchParams.get('token');
  if (!token) {
    fail(res, 401, 'NO_TOKEN', '缺少员工访问凭证，请扫描管理员提供的整改二维码。');
    return null;
  }
  const result = auth.verifyEmployeeToken(token);
  if (!result.ok) {
    const status = result.code === 'EXPIRED' ? 410 : 403;
    fail(res, status, result.code, result.message, result.expiredAt ? { expiredAt: result.expiredAt } : {});
    return null;
  }
  const emp = store.findEmployee(result.empId);
  if (!emp || emp.tokenVersion !== result.version) {
    fail(res, 410, 'LINK_REVOKED', '该链接已被管理员重新生成，请扫描最新的整改二维码。');
    return null;
  }
  return { employee: emp, exp: result.exp, token };
}

function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : [prev]), parts.join('; ')]);
}

// ---------- 图片处理 ----------
const IMAGE_SIGNATURES = [
  { ext: '.jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', test: b => b.readUInt32BE(0) === 0x89504e47 },
  { ext: '.gif', mime: 'image/gif', test: b => b.slice(0, 6).toString('ascii') === 'GIF87a' || b.slice(0, 6).toString('ascii') === 'GIF89a' },
  { ext: '.webp', mime: 'image/webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' }
];

function saveDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw err('BAD_IMAGE', 400, '图片数据格式不正确，请重新选择图片。');
  }
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/s.exec(dataUrl);
  if (!m) {
    throw err('UNSUPPORTED_IMAGE', 400, '仅支持 JPG / PNG / WEBP / GIF 格式的图片。');
  }
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw err('BAD_IMAGE', 400, '图片内容为空，请重新选择。');
  if (buf.length > MAX_IMG_BYTES) {
    throw err('IMAGE_TOO_LARGE', 413,
      `图片大小为 ${formatMB(buf.length)}，超过单张 5MB 的上限，请压缩或更换后重新上传。`,
      { actualBytes: buf.length, maxBytes: MAX_IMG_BYTES });
  }
  const sig = IMAGE_SIGNATURES.find(s => s.test(buf));
  if (!sig) {
    throw err('UNSUPPORTED_IMAGE', 400, '图片内容与类型不符或已损坏，请重新选择图片。');
  }
  const name = `${store.nextId('img')}${sig.ext}`;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

function err(code, status, message, extra) {
  return Object.assign(new Error(message), { code, status, message, extra });
}

// ---------- 业务逻辑 ----------
function employeeView(emp) {
  return {
    id: emp.id,
    name: emp.name,
    employeeNo: emp.employeeNo || '',
    phone: emp.phone || '',
    createdAt: emp.createdAt,
    linkExpiresAt: emp.linkExpiresAt
  };
}

async function buildLinkInfo(req, emp) {
  const token = auth.makeEmployeeToken(emp.id, emp.tokenVersion, emp.linkExpiresAt);
  const url = `${baseUrl(req)}/e/${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 280, margin: 1 });
  return { url, qrDataUrl, expiresAt: emp.linkExpiresAt };
}

function issueView(it) {
  const emp = store.findEmployee(it.empId);
  return {
    id: it.id,
    empId: it.empId,
    empName: emp ? emp.name : '(已删除员工)',
    item: it.item,
    points: it.points,
    note: it.note || '',
    photos: it.photos,
    createdAt: it.createdAt,
    rectify: it.rectify
  };
}

function validatePoints(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100 || Math.round(n * 10) !== n * 10) {
    throw err('BAD_POINTS', 400, '扣分数必须是 0~100 之间的正数（最多一位小数）。');
  }
  return n;
}

function issueStats(issues) {
  const rectified = issues.filter(i => i.rectify.at).length;
  const total = issues.length;
  return {
    total,
    rectified,
    pending: total - rectified,
    totalPoints: issues.reduce((s, i) => s + i.points, 0),
    progress: total === 0 ? 100 : Math.round((rectified / total) * 100)
  };
}

// ---------- 路由处理 ----------
const handlers = {
  // 登录（管理员/老板共用）
  'POST /api/login': async (req, res) => {
    const body = await readJson(req, res);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'boss' ? 'boss' : 'admin';
    if (!username || !password) {
      return fail(res, 400, 'MISSING_FIELDS', '请输入账号和密码。');
    }
    const user = store.findUser(username);
    if (!user || user.role !== role || !store.verifyPassword(password, user.salt, user.hash)) {
      return fail(res, 401, 'BAD_CREDENTIALS', '账号、密码或身份选择不正确。默认账号：管理员 admin/admin123，老板 boss/boss123。');
    }
    const sid = auth.createSession(user);
    setCookie(res, 'sid', sid, { secure: baseUrl(req).startsWith('https') });
    sendJson(res, 200, {
      role: user.role,
      name: user.name,
      redirect: user.role === 'admin' ? '/admin.html' : '/boss.html'
    });
  },

  'POST /api/logout': async (req, res) => {
    const cookies = parseCookiesSafe(req);
    auth.destroySession(cookies.sid);
    setCookie(res, 'sid', '', { maxAge: 0 });
    sendJson(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const sess = getSessionUser(req);
    if (!sess) return fail(res, 401, 'UNAUTHORIZED', '未登录。');
    const user = store.db.users.find(u => u.id === sess.userId);
    sendJson(res, 200, { role: sess.role, name: user ? user.name : '' });
  },

  // 员工扫码入口：校验签名/有效期，写 cookie 后跳转员工页
  'GET_/e/': async (req, res, token) => {
    const result = auth.verifyEmployeeToken(token);
    const failPage = (title, message, hint) => {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLinkError(title, message, hint));
    };
    if (!result.ok) {
      return failPage(
        result.code === 'EXPIRED' ? '链接已过期' : '链接无效',
        result.message,
        '请联系甲方管理员，在考核后台重新生成并发送最新二维码。'
      );
    }
    const emp = store.findEmployee(result.empId);
    if (!emp || emp.tokenVersion !== result.version) {
      return failPage('链接已失效', '管理员已重新生成该员工的整改链接，旧链接作废。', '请扫描最新的整改二维码。');
    }
    setCookie(res, 'emp_token', token, {
      maxAge: Math.floor((result.exp - Date.now()) / 1000),
      secure: baseUrl(req).startsWith('https')
    });
    res.writeHead(302, { Location: '/employee.html' });
    res.end();
  },

  // ---- 员工端接口 ----
  'GET /api/employee/me': async (req, res) => {
    const ctx = resolveEmployee(req, res);
    if (!ctx) return;
    const issues = store.db.issues
      .filter(i => i.empId === ctx.employee.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(issueView);
    sendJson(res, 200, {
      employee: employeeView(ctx.employee),
      linkExpiresAt: ctx.exp,
      stats: issueStats(store.db.issues.filter(i => i.empId === ctx.employee.id)),
      issues
    });
  },

  'POST /api/employee/issues/:id/rectify': async (req, res, params) => {
    const ctx = resolveEmployee(req, res);
    if (!ctx) return;
    const issue = store.findIssue(params.id);
    if (!issue || issue.empId !== ctx.employee.id) {
      return fail(res, 404, 'ISSUE_NOT_FOUND', '未找到对应的问题记录，可能已被删除。');
    }
    if (issue.rectify.at) {
      return fail(res, 409, 'ALREADY_RECTIFIED', '该问题已提交过整改照片，如需变更请联系甲方管理员。');
    }
    const body = await readJson(req, res);
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length === 0) return fail(res, 400, 'NO_PHOTOS', '请至少上传 1 张整改后的现场照片。');
    if (photos.length > MAX_PHOTOS_PER_ISSUE) {
      return fail(res, 400, 'TOO_MANY_PHOTOS', `每个问题最多上传 ${MAX_PHOTOS_PER_ISSUE} 张整改照片。`);
    }
    for (const p of photos) {
      if (typeof p !== 'string' || !/^\/uploads\//.test(p)) {
        return fail(res, 400, 'BAD_PHOTO', '整改照片数据无效，请重新上传。');
      }
      if (!fs.existsSync(path.join(store.UPLOAD_DIR, path.basename(p)))) {
        return fail(res, 400, 'PHOTO_MISSING', '部分图片未上传成功，请重新添加后再提交。');
      }
    }
    const note = String(body.note || '').slice(0, 200);
    const now = Date.now();
    await store.mutate(db => {
      const it = db.issues.find(x => x.id === issue.id);
      it.rectify = { photos, note, at: now, byName: ctx.employee.name };
    });
    sendJson(res, 200, { ok: true, rectifiedAt: now });
  },

  // ---- 管理员：员工 ----
  'GET /api/admin/employees': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const list = store.db.employees.map(employeeView)
      .sort((a, b) => b.createdAt - a.createdAt);
    sendJson(res, 200, { employees: list, linkValidDays: store.db.settings.linkValidDays });
  },

  'POST /api/admin/employees': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req, res);
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 20) {
      return fail(res, 400, 'BAD_NAME', '员工姓名为 2~20 个字符。');
    }
    const employeeNo = String(body.employeeNo || '').trim().slice(0, 30);
    const phone = String(body.phone || '').trim().slice(0, 20);
    if (phone && !/^[0-9+\- ]{5,20}$/.test(phone)) {
      return fail(res, 400, 'BAD_PHONE', '手机号/工号格式不正确。');
    }
    const days = Math.min(365, Math.max(1, Number(store.db.settings.linkValidDays) || 30));
    const now = Date.now();
    const emp = {
      id: store.nextId('emp'),
      name, employeeNo, phone,
      tokenVersion: 1,
      createdAt: now,
      linkExpiresAt: now + days * 86400000
    };
    await store.mutate(db => db.employees.push(emp));
    const link = await buildLinkInfo(req, emp);
    sendJson(res, 200, { employee: employeeView(emp), link });
  },

  'POST /api/admin/employees/:id/reset-link': async (req, res, params) => {
    if (!requireRole(req, res, 'admin')) return;
    const emp = store.findEmployee(params.id);
    if (!emp) return fail(res, 404, 'EMP_NOT_FOUND', '未找到该员工。');
    const body = await readJson(req, res).catch(() => ({}));
    const days = Math.min(365, Math.max(1, Number(body.validDays) || Number(store.db.settings.linkValidDays) || 30));
    const now = Date.now();
    await store.mutate(db => {
      const e = db.employees.find(x => x.id === emp.id);
      e.tokenVersion += 1;
      e.linkExpiresAt = now + days * 86400000;
    });
    const fresh = store.findEmployee(emp.id);
    const link = await buildLinkInfo(req, fresh);
    sendJson(res, 200, { employee: employeeView(fresh), link });
  },

  'GET /api/admin/employees/:id/link': async (req, res, params) => {
    if (!requireRole(req, res, 'admin')) return;
    const emp = store.findEmployee(params.id);
    if (!emp) return fail(res, 404, 'EMP_NOT_FOUND', '未找到该员工。');
    sendJson(res, 200, { employee: employeeView(emp), link: await buildLinkInfo(req, emp) });
  },

  'PUT /api/admin/settings': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req, res);
    const days = Number(body.linkValidDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return fail(res, 400, 'BAD_SETTING', '链接有效期必须是 1~365 之间的整数（天）。');
    }
    await store.mutate(db => { db.settings.linkValidDays = days; });
    sendJson(res, 200, { linkValidDays: days });
  },

  // ---- 管理员：图片上传 ----
  'POST /api/admin/upload-image': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req, res);
    try {
      const url = saveDataUrl(body.dataUrl);
      sendJson(res, 200, { url });
    } catch (e) {
      fail(res, e.status || 400, e.code || 'BAD_IMAGE', e.message, e.extra || {});
    }
  },

  // 员工端图片上传（token 鉴权）
  'POST /api/employee/upload-image': async (req, res) => {
    if (!resolveEmployee(req, res)) return;
    const body = await readJson(req, res);
    try {
      const url = saveDataUrl(body.dataUrl);
      sendJson(res, 200, { url });
    } catch (e) {
      fail(res, e.status || 400, e.code || 'BAD_IMAGE', e.message, e.extra || {});
    }
  },

  // ---- 管理员：问题/扣分 ----
  'GET /api/admin/issues': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const list = store.db.issues.slice().sort((a, b) => b.createdAt - a.createdAt).map(issueView);
    sendJson(res, 200, { issues: list });
  },

  'POST /api/admin/issues': async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const body = await readJson(req, res);
    const emp = store.findEmployee(String(body.empId || ''));
    if (!emp) return fail(res, 400, 'BAD_EMP', '请先选择要考核的外包员工。');
    const item = String(body.item || '').trim();
    if (!item || item.length > 50) return fail(res, 400, 'BAD_ITEM', '扣分项名称为 1~50 个字符。');
    const points = validatePoints(body.points);
    const note = String(body.note || '').trim().slice(0, 200);
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length === 0) return fail(res, 400, 'NO_PHOTOS', '请至少上传 1 张问题现场照片。');
    if (photos.length > MAX_PHOTOS_PER_ISSUE) {
      return fail(res, 400, 'TOO_MANY_PHOTOS', `每个问题最多上传 ${MAX_PHOTOS_PER_ISSUE} 张照片。`);
    }
    for (const p of photos) {
      if (typeof p !== 'string' || !/^\/uploads\//.test(p)) {
        return fail(res, 400, 'BAD_PHOTO', '照片数据无效，请重新上传。');
      }
    }
    const issue = {
      id: store.nextId('iss'),
      empId: emp.id,
      item, points, note,
      photos,
      createdAt: Date.now(),
      rectify: { photos: [], note: '', at: null, byName: '' }
    };
    await store.mutate(db => db.issues.push(issue));
    sendJson(res, 200, { issue: issueView(issue) });
  },

  // ---- 老板汇总 ----
  'GET /api/boss/summary': async (req, res) => {
    if (!requireRole(req, res, 'boss')) return;
    const employees = store.db.employees.slice().sort((a, b) => a.createdAt - b.createdAt);
    const groups = employees.map(emp => {
      const issues = store.db.issues.filter(i => i.empId === emp.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        employee: employeeView(emp),
        stats: issueStats(issues),
        issues: issues.map(issueView)
      };
    });
    const all = store.db.issues;
    sendJson(res, 200, {
      generatedAt: Date.now(),
      overall: {
        employeeCount: employees.length,
        ...issueStats(all)
      },
      groups
    });
  }
};

function renderLinkError(title, message, hint) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - 保洁外包考核站</title>
<style>
body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f6fa;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:14px;padding:32px 26px;max-width:380px;text-align:center;box-shadow:0 8px 30px rgba(20,40,80,.08)}
.icon{font-size:44px}.t{font-size:20px;font-weight:700;margin:12px 0 8px;color:#d4380d}
.m{color:#555;line-height:1.7;font-size:15px}.h{margin-top:14px;color:#99a;font-size:13px;line-height:1.6}
</style></head><body><div class="card"><div class="icon">⚠️</div><div class="t">${title}</div>
<div class="m">${message}</div><div class="h">${hint}</div></div></body></html>`;
}

// ---------- 静态文件 & 图片鉴权 ----------
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    return false;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveUpload(req, res, pathname) {
  const name = path.basename(pathname);
  if (name !== pathname.slice('/uploads/'.length)) return false;
  // 图片访问要求：管理端/老板会话 或 员工 token
  const sess = getSessionUser(req);
  const cookies = parseCookiesSafe(req);
  let authorized = sess && (sess.role === 'admin' || sess.role === 'boss');
  if (!authorized && cookies.emp_token) {
    const r = auth.verifyEmployeeToken(cookies.emp_token);
    authorized = r.ok && !!store.findEmployee(r.empId) && store.findEmployee(r.empId).tokenVersion === r.version;
  }
  if (!authorized) {
    fail(res, 403, 'FORBIDDEN_IMAGE', '无权查看该图片，请通过考核页面访问。');
    return true;
  }
  const filePath = path.join(store.UPLOAD_DIR, name);
  if (!filePath.startsWith(store.UPLOAD_DIR + path.sep) || !fs.existsSync(filePath)) {
    fail(res, 404, 'NOT_FOUND', '图片不存在或已被删除。');
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------- 主服务 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    if (pathname === '/favicon.ico') {
      res.writeHead(204); res.end(); return;
    }
    // /e/<token>
    if (req.method === 'GET' && pathname.startsWith('/e/')) {
      const token = decodeURIComponent(pathname.slice(3));
      return handlers['GET_/e/'](req, res, token);
    }
    if (pathname.startsWith('/uploads/')) {
      if (req.method !== 'GET') {
        res.writeHead(405); res.end(); return;
      }
      serveUpload(req, res, pathname);
      return;
    }
    if (pathname.startsWith('/api/')) {
      // 路由匹配（支持 :id 参数）
      const key = `${req.method} ${pathname}`;
      let handler = handlers[key];
      let params = {};
      if (!handler) {
        // 参数化路由
        const paramRoutes = Object.keys(handlers).filter(k => k.includes('/:'));
        for (const pr of paramRoutes) {
          const [method, pattern] = pr.split(' ');
          if (method !== req.method) continue;
          const pp = pattern.split('/');
          const kp = pathname.split('/');
          if (pp.length !== kp.length) continue;
          const p = {};
          let matched = true;
          for (let i = 0; i < pp.length; i++) {
            if (pp[i].startsWith(':')) p[pp[i].slice(1)] = decodeURIComponent(kp[i]);
            else if (pp[i] !== kp[i]) { matched = false; break; }
          }
          if (matched) { handler = handlers[pr]; params = p; break; }
        }
      }
      if (!handler) return fail(res, 404, 'NOT_FOUND', '接口不存在。');
      await handler(req, res, params);
      return;
    }
    // 静态页面
    if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
    fail(res, 404, 'NOT_FOUND', '页面不存在。');
  } catch (e) {
    if (res.headersSent) {
      try { res.end(); } catch {}
      return;
    }
    if (e.code === 'PAYLOAD_TOO_LARGE') {
      return fail(res, 413, e.code, e.message);
    }
    console.error('[server error]', e);
    fail(res, e.status || 500, e.code || 'SERVER_ERROR', e.message || '服务器开小差了，请稍后重试。');
  }
});

server.listen(PORT, () => {
  console.log(`保洁外包考核站已启动： http://localhost:${PORT}`);
  console.log('默认账号：管理员 admin/admin123 ｜ 老板 boss/boss123');
});
