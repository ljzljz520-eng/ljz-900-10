const express = require('express');
const db = require('../db');
const { parseCookies, requireAuth, formatTime } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 'BAD_INPUT', message: '请输入账号和密码' });
  }
  const user = db.findUser(String(username).trim());
  if (!user || !db.verifyPassword(String(password), user.salt, user.passwordHash)) {
    return res.status(401).json({ code: 'BAD_CREDENTIALS', message: '账号或密码错误' });
  }
  const sid = db.createSession(user.id, user.role);
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: db.SESSION_TTL_MS,
    path: '/',
  });
  res.json({
    role: user.role,
    username: user.username,
    displayName: user.displayName,
    expiresAt: Date.now() + db.SESSION_TTL_MS,
  });
});

router.post('/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) db.destroySession(sid);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.getUserById(req.user.role, req.user.id);
  if (!user) return res.status(401).json({ code: 'NOT_LOGGED_IN', message: '登录已失效' });
  res.json({
    role: user.role,
    username: user.username,
    displayName: user.displayName,
    serverTime: Date.now(),
    serverTimeText: formatTime(Date.now()),
  });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = db.getUserById(req.user.role, req.user.id);
  if (!user) return res.status(401).json({ code: 'NOT_LOGGED_IN', message: '登录已失效' });
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ code: 'BAD_INPUT', message: '请填写原密码和新密码' });
  }
  if (!db.verifyPassword(String(oldPassword), user.salt, user.passwordHash)) {
    return res.status(400).json({ code: 'BAD_OLD_PASSWORD', message: '原密码不正确' });
  }
  if (String(newPassword).length < 6 || String(newPassword).length > 64) {
    return res.status(400).json({ code: 'WEAK_PASSWORD', message: '新密码长度需为 6~64 位' });
  }
  db.setPassword(req.user.role, user.id, String(newPassword));
  res.json({ ok: true, message: '密码修改成功' });
});

module.exports = router;
