const db = require('./db');

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

// 已登录（管理员或老板）
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const session = db.getSession(cookies.sid);
  if (!session) {
    return res.status(401).json({ code: 'NOT_LOGGED_IN', message: '登录已失效，请重新登录' });
  }
  req.user = { id: session.userId, role: session.role };
  next();
}

// 仅管理员
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 'FORBIDDEN', message: '仅甲方管理员可执行此操作' });
    }
    next();
  });
}

// 员工整改链接 token（query 或 body）
function resolveEmployeeToken(req, res, next) {
  const token =
    (req.query && req.query.token) ||
    (req.body && req.body.token) ||
    parseCookies(req).etoken ||
    null;

  const record = db.getTokenRecord(token);
  if (!token || !record) {
    return res.status(401).json({
      code: 'BAD_TOKEN',
      message: '整改链接无效，可能已被管理员重新生成。请联系甲方管理员获取最新链接。',
    });
  }
  if (record.expiresAt <= Date.now()) {
    return res.status(410).json({
      code: 'TOKEN_EXPIRED',
      expiredAt: record.expiresAt,
      message:
        '整改链接已过期（有效期至 ' +
        formatTime(record.expiresAt) +
        '）。请联系甲方管理员重新发送链接。',
    });
  }
  const employee = db.getEmployee(record.employeeId);
  if (!employee || !employee.active) {
    return res.status(403).json({
      code: 'EMPLOYEE_INACTIVE',
      message: '员工账号已停用，请联系甲方管理员。',
    });
  }
  req.token = record;
  req.employee = employee;
  next();
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { parseCookies, requireAuth, requireAdmin, resolveEmployeeToken, formatTime };
