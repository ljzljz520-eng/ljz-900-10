'use strict';
/* 公共工具：请求、提示、灯箱、图片选择/压缩上传 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
}
function plural(n, u) { return n + ' ' + u; }

function toast(message, type = 'info', ms = 3200) {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
  return t;
}

/**
 * 统一请求：自动把后端 {error:{code,message}} 转成异常，并给出可读提示。
 */
async function api(path, opts = {}) {
  const headers = { 'Accept': 'application/json' };
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method: opts.method || 'GET', headers, body, credentials: 'same-origin' });
  } catch (networkErr) {
    throw { code: 'NETWORK', message: '网络连接失败，请检查网络后重试。' };
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw {
      status: res.status,
      code: err.code || 'HTTP_' + res.status,
      message: err.message || `请求失败（HTTP ${res.status}）`,
      raw: err
    };
  }
  return data;
}

// ---- 图片灯箱 ----
function initLightbox() {
  let lb = $('.lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = '<img alt="预览">';
    lb.addEventListener('click', () => lb.classList.remove('show'));
    document.body.appendChild(lb);
  }
  document.addEventListener('click', e => {
    const img = e.target.closest && e.target.closest('img.zoomable');
    if (img) {
      lb.querySelector('img').src = img.dataset.full || img.src;
      lb.classList.add('show');
    }
  });
}

function photoGrid(urls, cls = 'ph') {
  return `<div class="photo-grid">${urls.map(u =>
    `<img class="${cls} zoomable" data-full="${esc(u)}" src="${esc(u)}" alt="现场照片"
      loading="lazy">`).join('')}</div>`;
}

/**
 * 图片上传组件：
 * - 限制类型（jpg/png/webp/gif）与单张 5MB
 * - 客户端先用 canvas 压缩超尺寸图（最长边 1600），仍超限给出明确提示
 */
function createUploader({ acceptToken = false, max = 6, onChange } = {}) {
  const endpoint = acceptToken ? '/api/employee/upload-image' : '/api/admin/upload-image';
  const urls = [];
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="uploader">
      <div class="big">📷</div>
      <div><b>点击拍照 / 选择图片</b>，也可拖拽到这里</div>
      <div class="muted" style="margin-top:4px">单张不超过 5MB，支持 JPG / PNG / WEBP / GIF，最多 ${max} 张</div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden
        capture="environment">
    </div>
    <div class="thumbs" style="margin-top:10px"></div>`;
  const box = $('.uploader', root);
  const input = $('input', root);
  const thumbs = $('.thumbs', root);

  function render() {
    thumbs.innerHTML = '';
    urls.forEach((u, idx) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = `<img class="zoomable" src="${esc(u)}" alt="缩略图">
        <button type="button" class="x" title="移除">×</button>`;
      d.querySelector('img').addEventListener('click', e => {
        e.stopPropagation();
        const lb = $('.lightbox');
        lb.querySelector('img').src = u;
        lb.classList.add('show');
      });
      d.querySelector('.x').addEventListener('click', e => {
        e.stopPropagation();
        urls.splice(idx, 1);
        render();
        onChange && onChange(urls.slice());
      });
      thumbs.appendChild(d);
    });
  }

  function loading(on, text) {
    box.style.opacity = on ? '.6' : '';
    box.style.pointerEvents = on ? 'none' : '';
    box.querySelector('div:nth-child(2)').textContent = on ? (text || '上传中…') : '点击拍照 / 选择图片，也可拖拽到这里';
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  async function handleFiles(files) {
    const all = [...files];
    const rejected = all.filter(f => !f.type.startsWith('image/') || !ALLOWED_TYPES.includes(f.type));
    const list = all.filter(f => ALLOWED_TYPES.includes(f.type));
    if (rejected.length) {
      toast(`「${rejected[0].name || '该文件'}」不是支持的图片格式，仅支持 JPG / PNG / WEBP / GIF`, 'err', 4200);
    }
    if (!list.length) return;
    if (urls.length + list.length > max) {
      toast(`最多上传 ${max} 张图片（当前已有 ${urls.length} 张），已取消本次添加`, 'err');
      return;
    }
    for (const file of list) {
      if (file.size > 5 * 1024 * 1024) {
        toast(`「${file.name}」大小 ${fmtSize(file.size)}，超过单张 5MB 限制，系统将尝试压缩…`, 'info', 4000);
      }
      loading(true, `正在压缩并上传 ${file.name}…`);
      try {
        const dataUrl = await fileToCompressedDataUrl(file);
        const r = await api(endpoint, { method: 'POST', body: { dataUrl } });
        urls.push(r.url);
        render();
        onChange && onChange(urls.slice());
      } catch (err) {
        if (err.status === 413 || err.code === 'IMAGE_TOO_LARGE') {
          toast(`图片仍然过大：${err.message}`, 'err', 5000);
        } else if (err.status === 401 || err.status === 403 || err.status === 410) {
          toast(err.message, 'err', 5000);
        } else {
          toast(`上传失败：${err.message}`, 'err');
        }
      }
    }
    loading(false);
    input.value = '';
  }

  box.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleFiles(input.files));
  ['dragover', 'dragenter'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault(); box.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault(); box.classList.remove('dragover');
  }));
  box.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  return {
    el: root,
    urls,
    reset() { urls.length = 0; render(); onChange && onChange([]); }
  };
}

/** 读图 -> 必要时 canvas 压缩 -> dataURL（JPEG 0.82，超过约 4MB 继续降质） */
function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_EDGE = 1600;
        let { width, height } = img;
        if (width > MAX_EDGE || height > MAX_EDGE) {
          const k = Math.min(MAX_EDGE / width, MAX_EDGE / height);
          width = Math.round(width * k);
          height = Math.round(height * k);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = 0.82;
        let out = canvas.toDataURL('image/jpeg', quality);
        // dataURL base64 体积 ≈ 字节数 * 1.37；预留余量，逐级降质
        while (out.length * 0.75 > 4.6 * 1024 * 1024 && quality > 0.4) {
          quality -= 0.12;
          out = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('图片解析失败，文件可能已损坏'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', initLightbox);
