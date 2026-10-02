const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { uploadSingle } = require('../upload');

const router = express.Router();

/* ---------- 员工 ---------- */

router.get('/employees', requireAuth, (req, res) => {
  res.json(db.listEmployees(req.query.keyword));
});

router.post('/employees', requireAdmin, (req, res) => {
  const { name, employeeNo, phone } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ code: 'BAD_INPUT', message: '员工姓名不能为空' });
  }
  const employee = db.createEmployee({ name, employeeNo, phone });
  res.status(201).json(employee);
});

router.put('/employees/:id', requireAdmin, (req, res) => {
  const employee = db.updateEmployee(req.params.id, req.body || {});
  if (!employee) return res.status(404).json({ code: 'NOT_FOUND', message: '员工不存在' });
  res.json(employee);
});

/* ---------- 考核问题 ---------- */

router.get('/issues', requireAuth, (req, res) => {
  res.json(db.listIssues({ employeeId: req.query.employeeId, status: req.query.status }));
});

router.post('/issues', requireAdmin, uploadSingle('photo'), (req, res) => {
  const employeeId = Number(req.body.employeeId);
  const employee = db.getEmployee(employeeId);
  if (!employee) {
    if (req.file) db.removeUpload(req.file.filename);
    return res.status(400).json({ code: 'BAD_EMPLOYEE', message: '请选择有效的外包员工' });
  }
  const deductionItem = (req.body.deductionItem || '').trim();
  if (!deductionItem) {
    if (req.file) db.removeUpload(req.file.filename);
    return res.status(400).json({ code: 'BAD_INPUT', message: '扣分项不能为空' });
  }
  const points = Number(req.body.points);
  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    if (req.file) db.removeUpload(req.file.filename);
    return res.status(400).json({ code: 'BAD_POINTS', message: '扣分必须是 0~1000 之间的正数' });
  }
  if (!req.file) {
    return res.status(400).json({ code: 'NO_PHOTO', message: '请上传问题照片' });
  }
  const issue = db.createIssue({
    employeeId,
    photoFile: req.file.filename,
    deductionItem,
    points,
    remark: req.body.remark,
  });
  res.status(201).json(issue);
});

router.delete('/issues/:id', requireAdmin, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 'NOT_FOUND', message: '考核记录不存在' });
  db.deleteIssue(issue);
  res.json({ ok: true });
});

/* ---------- 整改链接 ---------- */

router.get('/tokens', requireAuth, (req, res) => {
  const now = Date.now();
  const result = db.listTokens().map((t) => ({
    ...t,
    status: t.expiresAt > now ? 'valid' : 'expired',
  }));
  res.json(result);
});

router.post('/employees/:id/token', requireAdmin, async (req, res) => {
  const employee = db.getEmployee(req.params.id);
  if (!employee) return res.status(404).json({ code: 'NOT_FOUND', message: '员工不存在' });
  const settings = db.getSettings();
  const ttlHours = Number((req.body || {}).ttlHours) || settings.tokenTTLHours;
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 24 * 90) {
    return res.status(400).json({ code: 'BAD_INPUT', message: '链接有效期需在 1~2160 小时之间' });
  }
  const token = db.createToken(employee.id, ttlHours);
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/e.html?token=${token.token}`;
  const qr = await QRCode.toDataURL(url, { width: 320, margin: 1 });
  res.status(201).json({ url, qr, ttlHours, ...token });
});

router.delete('/employees/:id/token', requireAdmin, (req, res) => {
  db.revokeToken(req.params.id);
  res.json({ ok: true, message: '整改链接已作废' });
});

/* ---------- 汇总 / 设置 ---------- */

router.get('/stats', requireAuth, (req, res) => {
  res.json(db.getStats());
});

router.get('/settings', requireAuth, (req, res) => {
  res.json(db.getSettings());
});

router.put('/settings', requireAdmin, (req, res) => {
  try {
    res.json(db.updateSettings(req.body || {}));
  } catch (e) {
    res.status(400).json({ code: 'BAD_INPUT', message: e.message });
  }
});

module.exports = router;
