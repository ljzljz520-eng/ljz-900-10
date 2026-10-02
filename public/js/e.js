/* ================= 员工整改端 ================= */

const TOKEN = new URLSearchParams(location.search).get('token');
const app = qs('#app');

function errorScreen({ icon = '⚠️', title, message, detail, expiredAt }) {
  app.innerHTML = `
    <div class="error-page">
      <div class="error-box">
        <div class="icon">${icon}</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${detail ? `<div class="detail">${detail}</div>` : ''}
        <div class="small muted">如确认链接无误仍无法访问，请截图本页面联系甲方管理员重新发送整改链接。</div>
      </div>
    </div>`;
}

function showTokenError(err) {
  if (err.code === 'TOKEN_EXPIRED') {
    errorScreen({
      icon: '⌛',
      title: '整改链接已过期',
      message: err.message,
      detail:
        `<div>🕐 到期时间：<b>${formatDateTime(err.data && err.data.expiredAt)}</b></div>` +
        `<div style="margin-top:6px">当前时间：${formatDateTime(Date.now())}</div>` +
        `<div style="margin-top:8px;color:var(--danger)">请联系甲方管理员重新生成并发送整改链接（或重新扫码）。</div>`,
    });
  } else if (err.code === 'BAD_TOKEN') {
    errorScreen({
      icon: '🚫',
      title: '整改链接无效',
      message: err.message,
      detail: TOKEN
        ? `<div class="small">链接特征码：${escapeHtml(TOKEN.slice(0, 12))}…<br>管理员每次重新生成链接，旧链接都会立即失效。</div>`
        : `<div>网址中缺少整改凭证（token）。<br>请通过管理员发送给你的完整链接或二维码进入，不要手动修改网址。</div>`,
    });
  } else if (err.code === 'EMPLOYEE_INACTIVE') {
    errorScreen({ icon: '🚷', title: '账号已停用', message: err.message });
  } else if (err.code === 'NETWORK_ERROR') {
    errorScreen({
      icon: '📵',
      title: '网络连接失败',
      message: '当前网络无法连接到考核服务器，请检查 Wi-Fi / 移动网络后刷新页面重试。',
    });
  } else {
    errorScreen({ icon: '❌', title: '页面加载失败', message: err.message || '请稍后重试' });
  }
}

/* ================= 主界面 ================= */

let meData = null;
let countdownTimer = null;

function renderShell() {
  const e = meData.employee;
  app.innerHTML = `
    <div class="e-header">
      <div class="container">
        <h1>🧹 ${escapeHtml(e.name)} 的整改清单</h1>
        <p>请逐条对照问题照片，完成整改后上传现场整改照片</p>
        <div class="countdown" id="countdown"></div>
      </div>
    </div>
    <main class="container" style="padding-top:18px;padding-bottom:40px">
      <div class="stat-grid">
        <div class="stat"><div class="num">${meData.issues.length}</div><div class="label">问题总数</div></div>
        <div class="stat"><div class="num" style="color:var(--warn)">${meData.issues.filter((i) => i.status === 'pending').length}</div><div class="label">待整改</div></div>
        <div class="stat"><div class="num" style="color:var(--success)">${meData.issues.filter((i) => i.status === 'rectified').length}</div><div class="label">已整改</div></div>
        <div class="stat"><div class="num danger">${meData.issues.reduce((s, i) => s + Number(i.points || 0), 0)}</div><div class="label">累计扣分</div></div>
      </div>
      <div id="issueList"></div>
    </main>`;
  renderCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(renderCountdown, 30000);
  renderIssues();
}

function renderCountdown() {
  const el = qs('#countdown');
  if (!el) return;
  const ms = meData.expiresAt - Date.now();
  if (ms <= 0) {
    clearInterval(countdownTimer);
    showTokenError({ code: 'TOKEN_EXPIRED', message: '整改链接已过期，请联系甲方管理员重新发送链接。', data: { expiredAt: meData.expiresAt } });
    return;
  }
  el.innerHTML = '🔗 链接有效期至 ' + formatDateTime(meData.expiresAt) + '（' + formatCountdown(ms) + '）';
}

function renderIssues() {
  const list = qs('#issueList');
  if (!meData.issues.length) {
    list.innerHTML = '<div class="card"><div class="empty"><div class="icon">✨</div>目前没有考核问题，继续保持！</div></div>';
    return;
  }
  list.innerHTML = meData.issues
    .slice()
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'pending' ? -1 : 1))
    .map(
      (i) => `
    <div class="issue-card" data-card="${i.id}">
      <div class="issue-head">
        <span class="item">${escapeHtml(i.deductionItem)}</span>
        <span class="badge badge-points">-${i.points} 分</span>
        ${i.status === 'rectified' ? '<span class="badge badge-done">✅ 已整改</span>' : '<span class="badge badge-pending">⏳ 待整改</span>'}
        <span class="spacer"></span>
        <span class="meta">${formatDateTime(i.createdAt)}</span>
      </div>
      <div class="photo-pair">
        <div class="photo-slot">
          <span class="tag tag-problem">问题</span>
          <img src="${imgUrl(i.photoFile)}" data-zoom="${imgUrl(i.photoFile)}" alt="问题照片">
        </div>
        <div class="photo-slot">
          ${i.rectifyFile
            ? `<span class="tag tag-fix">我的整改</span>
               <img src="${imgUrl(i.rectifyFile)}" data-zoom="${imgUrl(i.rectifyFile)}" alt="整改照片">`
            : '<div class="photo-empty">📷 整改完成后<br>请在下方上传整改照片</div>'}
        </div>
      </div>
      ${i.remark ? `<div class="issue-remark">📝 管理员备注：${escapeHtml(i.remark)}</div>` : ''}
      <div class="mt-3">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-file="${i.id}" style="display:none">
        <button class="btn ${i.status === 'rectified' ? '' : 'btn-primary'} btn-block" data-upload="${i.id}">
          ${i.status === 'rectified' ? '🔄 重新上传整改照片' : '📤 上传整改照片'}
        </button>
        <div class="small muted mt-2">支持 JPG / PNG / WEBP / GIF，单张不超过 5MB；过大的照片会自动压缩。</div>
      </div>
    </div>`
    )
    .join('');
}

/* ================= 事件 ================= */

app.addEventListener('click', (e) => {
  const zoom = e.target.dataset.zoom;
  if (zoom) return showLightbox(zoom);

  const btn = e.target.closest('[data-upload]');
  if (btn) {
    const id = btn.dataset.upload;
    const input = qs(`[data-file="${id}"]`);
    input.value = '';
    input.click();
  }
});

app.addEventListener('change', async (e) => {
  const id = e.target.dataset.file;
  if (!id) return;
  const file = e.target.files[0];
  if (!file) return;
  await uploadRectify(id, file);
});

async function uploadRectify(id, rawFile) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(rawFile.type)) {
    return toast('仅支持 JPG / PNG / WEBP / GIF 格式的图片', 'error', 4000);
  }
  const card = qs(`[data-card="${id}"]`);
  const btn = card.querySelector('[data-upload]');

  let file = rawFile;
  try {
    if (rawFile.size > 5 * 1024 * 1024) {
      toast('图片较大，正在自动压缩…', 'info', 2500);
      const r = await compressImage(rawFile);
      file = r.file;
      if (r.compressed) toast(`已压缩：${humanSize(rawFile.size)} → ${humanSize(file.size)}`, 'success', 3500);
    }
  } catch (err) {
    return toast(err.message, 'error', 5000);
  }

  btn.disabled = true;
  btn.textContent = '上传中… 请勿关闭页面';
  const fd = new FormData();
  fd.append('photo', file);
  try {
    // token 放 query：multipart body 在鉴权中间件阶段尚未解析
    const data = await api(
      `/api/employee/issues/${id}/rectify?token=${encodeURIComponent(TOKEN)}`,
      { method: 'POST', body: fd }
    );
    toast('整改照片上传成功，等待管理员复核 🎉', 'success', 4000);
    await loadData();
  } catch (err) {
    if (err.code === 'TOKEN_EXPIRED') return showTokenError(err);
    if (err.code === 'BAD_TOKEN') return showTokenError(err);
    if (err.code === 'FILE_TOO_LARGE') {
      toast(err.message, 'error', 6000);
    } else if (err.code === 'BAD_FILE_TYPE') {
      toast(err.message, 'error', 4000);
    } else if (err.code === 'NOT_FOUND') {
      toast('该考核问题不存在，正在刷新页面…', 'error');
      setTimeout(loadData, 1200);
    } else if (err.code === 'NETWORK_ERROR') {
      toast('网络异常，照片可能未上传成功。请切换网络后重试。', 'error', 5000);
    } else {
      toast('上传失败：' + err.message, 'error', 5000);
    }
    btn.disabled = false;
    btn.textContent = '📤 重新选择照片上传';
  }
}

/* ================= 启动 ================= */

async function loadData() {
  meData = await api('/api/employee/me?token=' + encodeURIComponent(TOKEN));
  renderShell();
}

(async function boot() {
  if (!TOKEN) {
    return showTokenError({ code: 'BAD_TOKEN', message: '网址缺少整改凭证，请扫描管理员提供的二维码进入，不要手动打开本页。' });
  }
  app.innerHTML = '<div class="loading" style="margin-top:30vh"><div class="spinner"></div>正在加载你的整改清单…</div>';
  try {
    await loadData();
  } catch (err) {
    showTokenError(err);
  }
})();
