/* ============ 通用工具 ============ */

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatCountdown(ms) {
  if (ms <= 0) return '已过期';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `剩余 ${d} 天 ${h} 小时`;
  if (h > 0) return `剩余 ${h} 小时 ${mm} 分`;
  return `剩余 ${mm} 分钟`;
}

/* ============ Toast ============ */

function toast(message, type = 'info', duration = 3200) {
  let wrap = qs('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, duration);
}

/* ============ API 封装 ============ */

async function api(url, options = {}) {
  const opts = { method: options.method || 'GET', headers: { ...(options.headers || {}) } };
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      opts.body = options.body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(options.body);
    }
  }
  let res, data;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试' };
  }
  const text = await res.text();
  data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = {
      status: res.status,
      code: data.code || 'ERROR',
      message: data.message || `请求失败（${res.status}）`,
      data,
    };
    // 登录失效统一处理（员工端页面自行处理 token 错误；登录页除外避免刷新循环）
    if (
      err.code === 'NOT_LOGGED_IN' &&
      !location.pathname.startsWith('/e') &&
      !location.pathname.startsWith('/login')
    ) {
      toast(err.message, 'warn');
      setTimeout(() => (location.href = '/login.html'), 900);
    }
    throw err;
  }
  return data;
}

/* ============ 模态框 ============ */

function openModal(id) {
  const m = qs('#' + id);
  if (m) m.classList.add('show');
}
function closeModal(id) {
  const m = qs('#' + id);
  if (m) m.classList.remove('show');
}
// 点遮罩 / 关闭按钮
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-mask')) {
    e.target.classList.remove('show');
  }
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) {
    const modal = closeBtn.closest('.modal-mask');
    if (modal) modal.classList.remove('show');
  }
});

function confirmDialog({ title = '确认操作', text = '', danger = false, confirmText = '确定' }) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">${escapeHtml(title)}</div>
        <div class="modal-body"><div>${escapeHtml(text)}</div></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const done = (ok) => { mask.remove(); resolve(ok); };
    mask.addEventListener('click', (e) => {
      if (e.target === mask) done(false);
      if (e.target.dataset.act === 'cancel') done(false);
      if (e.target.dataset.act === 'ok') done(true);
    });
  });
}

/* ============ 图片灯箱 ============ */

function showLightbox(src) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask show';
  mask.style.background = 'rgba(0,0,0,.82)';
  mask.innerHTML = `<img src="${escapeHtml(src)}" style="max-width:94%;max-height:90%;border-radius:8px">`;
  mask.addEventListener('click', () => mask.remove());
  document.body.appendChild(mask);
}

/* ============ 图片地址（员工端带 token） ============ */

function imgUrl(file) {
  if (!file) return '';
  const token = new URLSearchParams(location.search).get('token');
  return '/uploads/' + encodeURIComponent(file) + (token ? '?token=' + encodeURIComponent(token) : '');
}

/* ============ 客户端图片压缩（防图片过大） ============ */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const JPEG_TARGET = 3.5 * 1024 * 1024;

async function compressImage(file) {
  // gif 不压缩，直接透传
  if (file.type === 'image/gif') return { file, compressed: false };
  if (file.size <= MAX_UPLOAD_BYTES) return { file, compressed: false };
  try {
    const bitmap = await loadImageBitmap(file);
    const origW = bitmap.width || bitmap.naturalWidth;
    const origH = bitmap.height || bitmap.naturalHeight;
    let width = origW;
    let quality = 0.85;
    // 逐步缩小 + 降质量直到 < 目标大小
    let blob = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      blob = await drawToBlob(bitmap, origW, origH, width, quality);
      if (blob.size <= JPEG_TARGET) break;
      width = Math.round(width * 0.8);
      if (attempt === 2) quality = 0.7;
      if (attempt === 4) quality = 0.55;
    }
    bitmap.close && bitmap.close();
    if (!blob || blob.size > MAX_UPLOAD_BYTES) {
      throw new Error('压缩后仍超过 5MB');
    }
    const out = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    return { file: out, compressed: true, originalSize: file.size };
  } catch (e) {
    const err = new Error('图片过大（超过 5MB），且浏览器自动压缩失败，请更换更小的图片');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
}

function loadImageBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function drawToBlob(bitmap, origW, origH, width, quality) {
  return new Promise((resolve, reject) => {
    const height = Math.round(width * (origH / origW));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas 失败'))), 'image/jpeg', quality);
  });
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
