'use strict';

async function loadMe() {
  return api('/api/employee/me');
}

function render(data) {
  const { employee, stats, issues, linkExpiresAt } = data;
  $('#who').textContent = '员工端';
  $('#myName').textContent = `${employee.name} 的整改任务`;
  $('#sPoints').textContent = stats.totalPoints.toFixed(1).replace(/\.0$/, '');
  $('#sPending').textContent = stats.pending;
  $('#sDone').textContent = stats.rectified;
  $('#sProgress').textContent = stats.progress + '%';
  $('#sBar').style.width = stats.progress + '%';

  const leftDays = Math.ceil((linkExpiresAt - Date.now()) / 86400000);
  if (leftDays <= 3) {
    const b = $('#expireBanner');
    b.style.display = 'block';
    b.innerHTML = leftDays <= 0
      ? '⚠️ 您的整改链接已经过期，无法继续提交，请联系甲方管理员重新生成二维码。'
      : `⚠️ 您的整改链接将在 <b>${fmtDate(linkExpiresAt)}</b> 过期（还剩 ${leftDays} 天），请尽快完成整改。`;
  }

  if (!issues.length) {
    $('#issueList').innerHTML = '<div class="card"><div class="empty"><div class="big">🎉</div>目前没有考核记录。</div></div>';
    return;
  }

  $('#issueList').innerHTML = issues.map(i => {
    const done = !!i.rectify.at;
    return `
    <div class="card" id="issue-${i.id}">
      <div class="hd" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
        <div><span class="tt" style="font-weight:700">${esc(i.item)}</span>
          <span class="points" style="margin-left:10px">-${i.points} 分</span></div>
        ${done ? '<span class="badge done">已整改</span>' : '<span class="badge pending">待整改</span>'}
      </div>
      <div class="meta muted" style="margin:6px 0">登记时间：${fmtDate(i.createdAt)}${i.note ? '　说明：' + esc(i.note) : ''}</div>
      <div class="col">
        <div class="cap" style="font-size:13px;color:var(--sub);margin:8px 0 6px;font-weight:600">🔴 问题照片（请对照整改）</div>
        ${photoGrid(i.photos)}
      </div>
      <div id="rect-area-${i.id}" style="margin-top:12px">
        ${done ? `
          <div class="cap" style="font-size:13px;color:var(--sub);margin-bottom:6px;font-weight:600">🟢 我的整改照片</div>
          ${photoGrid(i.rectify.photos)}
          <div class="meta muted" style="margin-top:6px">已于 ${fmtDate(i.rectify.at)} 提交${i.rectify.note ? '　备注：' + esc(i.rectify.note) : ''}</div>
        ` : `
          <div class="cap" style="font-size:13px;color:var(--sub);margin-bottom:6px;font-weight:600">🟢 上传整改后的照片（至少 1 张）</div>
          <div id="up-${i.id}"></div>
          <textarea id="note-${i.id}" maxlength="200" placeholder="整改备注（选填），如：已重新拖洗、更换垃圾袋"
            style="margin-top:10px"></textarea>
          <button class="btn" data-submit="${i.id}" style="margin-top:10px">提交整改照片</button>
        `}
      </div>
    </div>`;
  }).join('');

  // 为每个待整改问题挂载独立上传器
  const uploaders = {};
  issues.forEach(i => {
    if (i.rectify.at) return;
    const up = createUploader({ acceptToken: true, max: 6 });
    $(`#up-${i.id}`).appendChild(up.el);
    uploaders[i.id] = up;
  });

  $('#issueList').onclick = async e => {
    const btn = e.target.closest('button[data-submit]');
    if (!btn) return;
    const id = btn.dataset.submit;
    const up = uploaders[id];
    if (!up.urls.length) return toast('请先拍摄/选择至少 1 张整改照片', 'err');
    const note = $(`#note-${id}`).value.trim();
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      await api(`/api/employee/issues/${id}/rectify`, {
        method: 'POST',
        body: { photos: up.urls.slice(), note }
      });
      toast('整改照片提交成功！', 'ok');
      const data2 = await loadMe();
      render(data2);
    } catch (err) {
      handleErr(err);
      btn.disabled = false; btn.textContent = '提交整改照片';
    }
  };
}

function fatalError(err) {
  const map = {
    NO_TOKEN: { icon: '🔐', title: '缺少访问凭证' },
    INVALID_TOKEN: { icon: '🚫', title: '链接无效' },
    EXPIRED: { icon: '⏰', title: '链接已过期' },
    LINK_REVOKED: { icon: '🔄', title: '链接已更新' }
  };
  const info = map[err.code] || { icon: '⚠️', title: '无法访问' };
  document.querySelector('.wrap').innerHTML = `
    <div class="card" style="margin-top:40px;text-align:center">
      <div style="font-size:46px">${info.icon}</div>
      <h2 style="justify-content:center;color:var(--danger);margin-top:10px">${info.title}</h2>
      <p style="color:#555;line-height:1.8">${esc(err.message)}</p>
      <p class="muted" style="line-height:1.7">请联系甲方管理员，在考核后台重新生成并发送最新的整改二维码。</p>
    </div>`;
}

function handleErr(err) {
  if (err.status === 401 || err.status === 403 || err.status === 410) {
    fatalError(err);
  } else if (err.code === 'NETWORK') {
    toast('网络连接失败，请检查手机网络后重试', 'err', 5000);
  } else {
    toast(err.message || '操作失败，请重试', 'err', 5000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await loadMe();
    render(data);
  } catch (err) {
    handleErr(err);
  }
});
