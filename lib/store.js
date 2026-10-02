'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: '甲方管理员' };
const DEFAULT_BOSS = { username: 'boss', password: 'boss123', name: '外包老板' };

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function seedDb() {
  const admin = hashPassword(DEFAULT_ADMIN.password);
  const boss = hashPassword(DEFAULT_BOSS.password);
  return {
    seq: 1,
    users: [
      { id: 'u-admin', role: 'admin', username: DEFAULT_ADMIN.username, name: DEFAULT_ADMIN.name, salt: admin.salt, hash: admin.hash },
      { id: 'u-boss', role: 'boss', username: DEFAULT_BOSS.username, name: DEFAULT_BOSS.name, salt: boss.salt, hash: boss.hash }
    ],
    employees: [],
    issues: [],
    settings: { linkValidDays: 30 }
  };
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    const seed = seedDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const db = JSON.parse(raw);
  if (!db.settings) db.settings = { linkValidDays: 30 };
  return db;
}

let db = load();
let writing = Promise.resolve();

/**
 * 修改数据并做原子持久化（通过临时文件 + rename，避免写坏数据文件）。
 */
async function mutate(fn) {
  const run = writing.then(async () => {
    fn(db);
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  });
  writing = run.catch(() => {});
  await run;
}

function nextId(prefix) {
  const n = db.seq++;
  return `${prefix}_${Date.now().toString(36)}${n.toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

function findUser(username) {
  return db.users.find(u => u.username === String(username).trim().toLowerCase());
}

function findEmployee(empId) {
  return db.employees.find(e => e.id === empId);
}

function findIssue(issueId) {
  return db.issues.find(i => i.id === issueId);
}

module.exports = {
  UPLOAD_DIR,
  get db() { return db; },
  mutate,
  nextId,
  hashPassword,
  verifyPassword,
  findUser,
  findEmployee,
  findIssue
};
