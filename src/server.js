const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const { parseCookies } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/employee', require('./routes/employee'));

// 图片访问：登录态（管理员/老板，全部可见）或有效员工 token（仅本人图片）
app.get('/uploads/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const target = path.join(db.UPLOAD_DIR, file);
  if (!fs.existsSync(target)) {
    return res.status(404).sendFile(path.join(__dirname, '..', 'public', '403.html'));
  }
  const session = db.getSession(parseCookies(req).sid);
  if (session) return res.sendFile(target, { maxAge: '7d' });

  const tokenRecord = db.getTokenRecord(req.query.token);
  if (
    tokenRecord &&
    tokenRecord.expiresAt > Date.now() &&
    db.tokenBelongsToFile(tokenRecord, file)
  ) {
    return res.sendFile(target, { maxAge: '7d' });
  }
  return res.status(403).sendFile(path.join(__dirname, '..', 'public', '403.html'));
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  extensions: ['html'],
}));

// 未匹配 API → JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' });
});

// 友好路径（无 .html 后缀）
app.get(['/login', '/admin', '/boss', '/e'], (req, res) => {
  const page = { '/login': 'login.html', '/admin': 'admin.html', '/boss': 'boss.html', '/e': 'e.html' }[req.path];
  res.sendFile(path.join(__dirname, '..', 'public', page));
});

app.get('/', (req, res) => {
  const session = db.getSession(parseCookies(req).sid);
  const target = session ? (session.role === 'admin' ? '/admin.html' : '/boss.html') : '/login.html';
  res.redirect(target);
});

// JSON 错误兜底
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'BAD_JSON', message: '请求数据格式错误' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: '提交内容过大' });
  }
  console.error(err);
  res.status(500).json({ code: 'SERVER_ERROR', message: '服务器开小差了，请稍后重试' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`保洁外包考核站已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
