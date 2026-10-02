'use strict';

async function guard() {
  try {
    const me = await api('/api/me');
    if (me.role !== 'boss') { location.href = '/'; return null; }
    $('#who').textContent = me.name;
    return me;
  } catch { location.href = '/'; return null; }
}

function statCard(n, l, cls = '') {
  return `<div class="stat"><div class="n ${cls}">${n}</div><div class="l">${l}</div></div>`;
}

function issueBlock(i) {
  const done = !!i.rectify.at;
  return `
  <div class="issue">
    <div class="hd">
      <div><span class="tt">${esc(i.item)}</span>
        <span class="points" style="margin-left:8px">-${i.points} 分</span></div>
      ${done ? '<span class="badge done">已整改</span>' : '<span class="badge pending">待整改</span>'}
    </div>
    ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}
    <div class="photo-pair" style="margin-top:10px">
      <div class="col">
        <div class="cap">🔴 问题照片 <span class="meta">${fmtDate(i.createdAt)}</span></div>
        ${photoGrid(i.photos)}
      </div>
      <div class="col">
        <div class="cap">🟢 整改照片</div>
        ${done
          ? `${photoGrid(i.rectify.photos)}<div class="meta" style="margin-top:6px">${esc(i.rectify.byName || '员工')} 于 ${fmtDate(i.rectify.at)} 提交${i.rectify.note ? '　' + esc(i.rectify.note) : ''}</div>`
          : '<div class="muted" style="padding:10px 0">⏳ 员工尚未提交整改照片</div>'}
      </div>
    </div>
  </div>`;
}

function render(data) {
  const o = data.overall;
  $('#overall').innerHTML =
    statCard(o.employeeCount, '外包员工人数') +
    statCard(o.total.toFixed(1).replace(/\.0$/, '') + ' 分', '累计总扣分', 'red') +
    statCard(o.pending, '待整改问题', 'orange') +
    statCard(o.rectified, '已整改问题', 'green') +
    statCard(o.progress + '%', `整改进度（${o.rectified}/${o.total}）`) +
    `<div class="stat" style="grid-column:span 1"><div class="l">进度条</div>
      <div class="progress" style="margin-top:12px"><i style="width:${o.progress}%"></i></div></div>`;
  $('#genAt').textContent = `数据更新时间：${fmtDate(data.generatedAt)}`;

  if (!data.groups.length) {
    $('#groups').innerHTML = '<div class="card"><div class="empty"><div class="big">👷</div>暂无员工数据，等待甲方管理员录入。</div></div>';
    return;
  }

  $('#groups').innerHTML = data.groups.map((g, idx) => {
    const s = g.stats;
    const e = g.employee;
    const expired = e.linkExpiresAt <= Date.now();
    return `
    <div class="emp-block ${s.total ? '' : ''}" data-idx="${idx}">
      <div class="hd">
        <span class="nm">${esc(e.name)}</span>
        ${e.employeeNo ? `<span class="emp-chip">工号 ${esc(e.employeeNo)}</span>` : ''}
        <span class="badge ${s.totalPoints ? 'red' : 'gray'}">总扣分 ${s.totalPoints.toFixed(1).replace(/\.0$/, '')}</span>
        <span class="badge ${s.pending ? 'pending' : 'done'}">${s.pending ? '待整改 ' + s.pending : '全部整改完成'}</span>
        <span class="muted">进度 ${s.progress}%（${s.rectified}/${s.total}）</span>
        ${expired ? '<span class="badge red">整改链接已过期</span>' : ''}
        <span class="chev">▾</span>
      </div>
      <div class="bd">
        <div class="stat-grid" style="margin-bottom:12px">
          ${statCard(s.totalPoints.toFixed(1).replace(/\.0$/, ''), '该员工总扣分', 'red')}
          ${statCard(s.pending, '待整改', 'orange')}
          ${statCard(s.rectified, '已整改', 'green')}
        </div>
        <div class="progress" style="margin-bottom:14px"><i style="width:${s.progress}%"></i></div>
        ${s.total
          ? g.issues.map(issueBlock).join('')
          : '<div class="empty" style="padding:18px">暂无考核记录</div>'}
      </div>
    </div>`;
  }).join('');

  // 默认：有待整改的员工展开，全部完成的折叠
  $$('.emp-block').forEach((el, idx) => {
    const g = data.groups[idx];
    if (g && g.stats.pending === 0 && g.stats.total > 0) el.classList.add('closed');
    el.querySelector('.hd').addEventListener('click', () => el.classList.toggle('closed'));
  });
}

async function load() {
  try {
    const data = await api('/api/boss/summary');
    render(data);
  } catch (err) {
    toast('加载汇总失败：' + err.message, 'err', 5000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!await guard()) return;
  $('#refreshBtn').addEventListener('click', () => {
    toast('正在刷新…', 'info', 1200);
    load();
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
  await load();
  setInterval(load, 60000); // 每分钟自动刷新
});
