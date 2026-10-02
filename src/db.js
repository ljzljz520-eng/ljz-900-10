const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 登录会话 7 天

function emptyDB() {
  return {
    seq: { employee: 1, issue: 1, session: 1 },
    admins: [],
    bosses: [],
    employees: [],
    issues: [],
    tokens: [],
    sessions: [],
    settings: { tokenTTLHours: 72 },
  };
}

let db;

function seed() {
  const admin = hashPassword('admin123');
  const boss = hashPassword('boss123');
  db.admins.push({
    id: 1,
    username: 'admin',
    role: 'admin',
    displayName: '甲方管理员',
    salt: admin.salt,
    passwordHash: admin.hash,
    createdAt: Date.now(),
  });
  db.bosses.push({
    id: 1,
    username: 'boss',
    role: 'boss',
    displayName: '老板',
    salt: boss.salt,
    passwordHash: boss.hash,
    createdAt: Date.now(),
  });
}

function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = emptyDB();
    seed();
    save();
  } else {
    db = Object.assign(emptyDB(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

/* ---------------- 账号与会话 ---------------- */

function findUser(username) {
  const admin = db.admins.find((u) => u.username === username);
  if (admin) return admin;
  return db.bosses.find((u) => u.username === username) || null;
}

function getUserById(role, id) {
  const list = role === 'admin' ? db.admins : db.bosses;
  return list.find((u) => u.id === Number(id)) || null;
}

function setPassword(role, id, newPassword) {
  const list = role === 'admin' ? db.admins : db.bosses;
  const user = list.find((u) => u.id === id);
  if (!user) return false;
  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.passwordHash = hash;
  save();
  return true;
}

function createSession(userId, role) {
  const now = Date.now();
  const sid = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    id: db.seq.session++,
    sid,
    userId,
    role,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  pruneSessions(now);
  save();
  return sid;
}

function pruneSessions(now) {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  return db.sessions.length !== before;
}

function getSession(sid) {
  if (!sid) return null;
  const now = Date.now();
  const session = db.sessions.find((s) => s.sid === sid && s.expiresAt > now);
  if (!session) {
    if (pruneSessions(now)) save();
    return null;
  }
  // 滑动续期
  session.expiresAt = now + SESSION_TTL_MS;
  save();
  return session;
}

function destroySession(sid) {
  db.sessions = db.sessions.filter((s) => s.sid !== sid);
  save();
}

/* ---------------- 员工 ---------------- */

function listEmployees(keyword) {
  let rows = db.employees.slice().sort((a, b) => a.id - b.id);
  if (keyword) {
    const k = String(keyword).trim().toLowerCase();
    rows = rows.filter(
      (e) =>
        e.name.toLowerCase().includes(k) ||
        (e.employeeNo || '').toLowerCase().includes(k) ||
        (e.phone || '').includes(k)
    );
  }
  return rows;
}

function getEmployee(id) {
  return db.employees.find((e) => e.id === Number(id)) || null;
}

function createEmployee({ name, employeeNo, phone }) {
  const employee = {
    id: db.seq.employee++,
    name: name.trim(),
    employeeNo: (employeeNo || '').trim(),
    phone: (phone || '').trim(),
    active: 1,
    createdAt: Date.now(),
  };
  db.employees.push(employee);
  save();
  return employee;
}

function updateEmployee(id, patch) {
  const employee = getEmployee(id);
  if (!employee) return null;
  if (patch.name !== undefined) employee.name = String(patch.name).trim();
  if (patch.employeeNo !== undefined) employee.employeeNo = String(patch.employeeNo).trim();
  if (patch.phone !== undefined) employee.phone = String(patch.phone).trim();
  if (patch.active !== undefined) employee.active = patch.active ? 1 : 0;
  save();
  return employee;
}

/* ---------------- 考核问题 ---------------- */

function listIssues(filter = {}) {
  let rows = db.issues.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (filter.employeeId) rows = rows.filter((i) => i.employeeId === Number(filter.employeeId));
  if (filter.status === 'pending') rows = rows.filter((i) => i.status === 'pending');
  if (filter.status === 'rectified') rows = rows.filter((i) => i.status === 'rectified');
  return rows;
}

function getIssue(id) {
  return db.issues.find((i) => i.id === Number(id)) || null;
}

function createIssue({ employeeId, photoFile, deductionItem, points, remark }) {
  const issue = {
    id: db.seq.issue++,
    employeeId: Number(employeeId),
    photoFile,
    deductionItem: deductionItem.trim(),
    points: Number(points),
    remark: (remark || '').trim(),
    status: 'pending',
    rectifyFile: null,
    rectifiedAt: null,
    createdAt: Date.now(),
  };
  db.issues.push(issue);
  save();
  return issue;
}

function markRectified(issue, rectifyFile) {
  if (issue.rectifyFile && issue.rectifyFile !== rectifyFile) removeUpload(issue.rectifyFile);
  issue.rectifyFile = rectifyFile;
  issue.status = 'rectified';
  issue.rectifiedAt = Date.now();
  save();
  return issue;
}

function deleteIssue(issue) {
  removeUpload(issue.photoFile);
  removeUpload(issue.rectifyFile);
  db.issues = db.issues.filter((i) => i.id !== issue.id);
  save();
}

function removeUpload(file) {
  if (!file) return;
  const target = path.join(UPLOAD_DIR, path.basename(file));
  fs.rm(target, { force: true }, () => {});
}

/* ---------------- 整改链接 token ---------------- */

function createToken(employeeId, ttlHours) {
  const now = Date.now();
  // 每个员工仅保留一个有效 token：作废旧链接
  db.tokens = db.tokens.filter((t) => t.employeeId !== Number(employeeId));
  const token = {
    token: crypto.randomBytes(24).toString('hex'),
    employeeId: Number(employeeId),
    createdAt: now,
    expiresAt: now + Number(ttlHours) * 60 * 60 * 1000,
  };
  db.tokens.push(token);
  save();
  return token;
}

function revokeToken(employeeId) {
  db.tokens = db.tokens.filter((t) => t.employeeId !== Number(employeeId));
  save();
}

function getTokenRecord(token) {
  if (!token) return null;
  return db.tokens.find((t) => t.token === token) || null;
}

function listTokens() {
  return db.tokens.slice();
}

function tokenBelongsToFile(token, file) {
  return db.issues.some(
    (i) =>
      i.employeeId === token.employeeId &&
      (i.photoFile === file || i.rectifyFile === file)
  );
}

/* ---------------- 汇总统计 ---------------- */

function getStats() {
  const employees = listEmployees();
  const rows = employees.map((e) => {
    const issues = db.issues.filter((i) => i.employeeId === e.id);
    const rectified = issues.filter((i) => i.status === 'rectified');
    const totalPoints = issues.reduce((s, i) => s + Number(i.points || 0), 0);
    const token = db.tokens.find((t) => t.employeeId === e.id) || null;
    return {
      id: e.id,
      name: e.name,
      employeeNo: e.employeeNo,
      phone: e.phone,
      active: e.active,
      issueCount: issues.length,
      rectifiedCount: rectified.length,
      pendingCount: issues.length - rectified.length,
      totalPoints: Math.round(totalPoints * 100) / 100,
      progress: issues.length ? Math.round((rectified.length / issues.length) * 100) : 100,
      tokenStatus: token
        ? token.expiresAt > Date.now()
          ? 'valid'
          : 'expired'
        : 'none',
      tokenExpiresAt: token ? token.expiresAt : null,
    };
  });

  const totalIssues = db.issues.length;
  const totalRectified = db.issues.filter((i) => i.status === 'rectified').length;
  const totalPoints = db.issues.reduce((s, i) => s + Number(i.points || 0), 0);
  return {
    overall: {
      employeeCount: employees.length,
      activeCount: employees.filter((e) => e.active).length,
      issueCount: totalIssues,
      rectifiedCount: totalRectified,
      pendingCount: totalIssues - totalRectified,
      totalPoints: Math.round(totalPoints * 100) / 100,
      progress: totalIssues ? Math.round((totalRectified / totalIssues) * 100) : 100,
    },
    employees: rows,
  };
}

function getSettings() {
  return { ...db.settings };
}

function updateSettings(patch) {
  if (patch.tokenTTLHours !== undefined) {
    const v = Number(patch.tokenTTLHours);
    if (!Number.isFinite(v) || v < 1 || v > 24 * 90) {
      throw new Error('链接有效期需在 1 ~ 2160 小时之间');
    }
    db.settings.tokenTTLHours = v;
  }
  save();
  return getSettings();
}

load();

module.exports = {
  UPLOAD_DIR,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  findUser,
  getUserById,
  setPassword,
  createSession,
  getSession,
  destroySession,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  listIssues,
  getIssue,
  createIssue,
  markRectified,
  deleteIssue,
  removeUpload,
  createToken,
  revokeToken,
  getTokenRecord,
  listTokens,
  tokenBelongsToFile,
  getStats,
  getSettings,
  updateSettings,
};
