const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR, removeUpload } = require('./db');

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// 通过文件头魔术字节校验真实类型
function sniffMime(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = EXT[file.mimetype] || path.extname(file.originalname) || '.jpg';
    cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + ext);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      const err = new Error('仅支持 JPG / PNG / WEBP / GIF 格式的图片');
      err.code = 'BAD_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  },
});

// 单文件上传包装：把 multer 错误翻译成清晰中文提示
function uploadSingle(field) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            code: 'FILE_TOO_LARGE',
            message: '图片过大：单张图片不能超过 5MB，请压缩后重新上传（系统会自动压缩，如仍超限请降低分辨率）。',
            limitBytes: MAX_SIZE,
          });
        }
        if (err.code === 'BAD_FILE_TYPE') {
          return res.status(415).json({ code: 'BAD_FILE_TYPE', message: err.message });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ code: 'NO_PHOTO', message: '缺少要上传的图片' });
        }
        return res.status(400).json({ code: 'UPLOAD_FAILED', message: '图片上传失败：' + err.message });
      }
      if (req.file) {
        const realMime = sniffMime(req.file.path);
        if (!realMime || realMime !== req.file.mimetype) {
          removeUpload(req.file.filename);
          return res.status(415).json({
            code: 'BAD_FILE_TYPE',
            message: '文件内容不是有效的 ' + (req.file.mimetype || '图片') + ' 图片，请重新选择真实的图片文件',
          });
        }
      }
      next();
    });
  };
}

module.exports = { uploadSingle, MAX_SIZE };
