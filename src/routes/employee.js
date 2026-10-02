const express = require('express');
const db = require('../db');
const { resolveEmployeeToken } = require('../auth');
const { uploadSingle } = require('../upload');

const router = express.Router();

// 员工本人的考核信息
router.get('/me', resolveEmployeeToken, (req, res) => {
  const issues = db.listIssues({ employeeId: req.employee.id });
  res.json({
    employee: {
      id: req.employee.id,
      name: req.employee.name,
      employeeNo: req.employee.employeeNo,
    },
    expiresAt: req.token.expiresAt,
    issues: issues.map((i) => ({
      id: i.id,
      deductionItem: i.deductionItem,
      points: i.points,
      remark: i.remark,
      status: i.status,
      photoFile: i.photoFile,
      rectifyFile: i.rectifyFile,
      createdAt: i.createdAt,
      rectifiedAt: i.rectifiedAt,
    })),
  });
});

// 单条问题（校验归属）
router.get('/issues/:id', resolveEmployeeToken, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue || issue.employeeId !== req.employee.id) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '未找到该考核问题' });
  }
  res.json(issue);
});

// 上传/更换整改照片
router.post('/issues/:id/rectify', resolveEmployeeToken, uploadSingle('photo'), (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue || issue.employeeId !== req.employee.id) {
    if (req.file) db.removeUpload(req.file.filename);
    return res.status(404).json({ code: 'NOT_FOUND', message: '未找到该考核问题' });
  }
  if (!req.file) {
    return res.status(400).json({ code: 'NO_PHOTO', message: '请选择整改照片' });
  }
  db.markRectified(issue, req.file.filename);
  res.json({ ok: true, message: '整改照片上传成功', issue });
});

module.exports = router;
