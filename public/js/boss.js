let statsData = null;
let issuesCache = [];
const expanded = new Set();

async function boot() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (e) {
    location.href = '/login.html';
    return;
  }
  if (me.role !== 'boss') {
    toast('该页面为老板只读视图，跳转管理台', 'warn');
    setTimeout(() => (location.href = '/admin.html'), 800);
    return;
  }
  qs('#userName').textContent = me.displayName + '（' + me.username + '）';
  await loadData();
}

async function loadData() {
  [statsData, issuesCache] = await Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/issues'),
  ]);
  renderOverall();
  renderList();
}

function renderOverall() {
  const o = statsData.overall;
  qs('#overall').innerHTML = `
    <div class="stat"><div class="num teal">${o.employeeCount}</div><div class="label">外包员工（在职 ${o.activeCount}）</div></div>
    <div class="stat"><div class="num">${o.issueCount}</div><div class="label">问题总数</div></div>
    <div class="stat"><div class="num" style="color:var(--success)">${o.rectifiedCount}</div><div class="label">已整改</div></div>
    <div class="stat"><div class="num" style="color:var(--warn)">${o.pendingCount}</div><div class="label">待整改</div></div>
    <div class="stat"><div class="num danger">-${o.totalPoints}</div><div class="label">总扣分</div></div>
    <div class="stat">
      <div class="num teal">${o.progress}%</div><div class="label">整改进度</div>
      <div class="progress mt-2"><span style="width:${o.progress}%"></span></div>
    </div>`;
}

qs('#searchInput').addEventListener('input', renderList);
qs('#progressFilter').addEventListener('change', renderList);
qs('#sortBy').addEventListener('change', renderList);
qs('#expandAllBtn').addEventListener('click', () => {
  statsData.employees.forEach((e) => expanded.add(e.id));
  renderList();
});
qs('#collapseAllBtn').addEventListener('click', () => {
  expanded.clear();
  renderList();
});

function getFilteredEmployees() {
  const kw = qs('#searchInput').value.trim().toLowerCase();
  const pf = qs('#progressFilter').value;
  const sortBy = qs('#sortBy').value;
  let rows = statsData.employees.filter((e) => {
    if (kw && !(e.name.toLowerCase().includes(kw) || (e.employeeNo || '').toLowerCase().includes(kw))) return false;
    if (pf === 'pending' && e.pendingCount === 0) return false;
    if (pf === 'done' && (e.issueCount === 0 || e.pendingCount > 0)) return false;
    if (pf === 'empty' && e.issueCount > 0) return false;
    return true;
  });
  rows.sort((a, b) => {
    if (sortBy === 'points') return b.totalPoints - a.totalPoints;
    if (sortBy === 'pending') return b.pendingCount - a.pendingCount;
    if (sortBy === 'progress') return a.progress - b.progress;
    return a.name.localeCompare(b.name, 'zh');
  });
  return rows;
}

function renderList() {
  const wrap = qs('#employeeList');
  const rows = getFilteredEmployees();
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty"><div class="icon">🔍</div>没有符合条件的员工</div>';
    return;
  }
  wrap.innerHTML = rows.map(employeeCard).join('');
}

function employeeCard(s) {
  const mine = issuesCache.filter((i) => i.employeeId === s.id);
  const isOpen = expanded.has(s.id);
  const linkInfo =
    s.tokenStatus === 'valid'
      ? '<span class="badge badge-done">整改链接有效</span>'
      : s.tokenStatus === 'expired'
        ? '<span class="badge badge-expired">链接已过期</span>'
        : '<span class="badge badge-none">未发链接</span>';
  return `
  <div class="issue-card" data-emp-card="${s.id}">
    <div class="issue-head" style="cursor:pointer" data-toggle="${s.id}">
      <span style="font-size:18px">${isOpen ? '🔽' : '▶️'}</span>
      <span class="item" style="font-size:16px">${escapeHtml(s.name)}</span>
      ${s.employeeNo ? `<span class="meta">工号 ${escapeHtml(s.employeeNo)}</span>` : ''}
      ${s.active ? '' : '<span class="badge badge-none">已停用</span>'}
      <span class="badge badge-points">总扣分 ${s.totalPoints}</span>
      <span class="meta">${s.rectifiedCount}/${s.issueCount} 已整改</span>
      ${linkInfo}
      <span class="spacer"></span>
      <div class="progress-wrap" style="min-width:150px">
        <div class="progress"><span style="width:${s.progress}%"></span></div>
        <span class="pct">${s.progress}%</span>
      </div>
    </div>
    ${isOpen ? employeeDetail(s, mine) : ''}
  </div>`;
}

function employeeDetail(s, mine) {
  if (!mine.length) {
    return '<div class="empty small" style="padding:20px"><div class="icon">✨</div>该员工暂无考核问题</div>';
  }
  return mine
    .map((i) => `
    <div style="border-top:1px dashed var(--border);padding-top:12px;margin-top:12px">
      <div class="issue-head">
        <span class="item">${escapeHtml(i.deductionItem)}</span>
        <span class="badge badge-points">-${i.points} 分</span>
        ${i.status === 'rectified'
          ? '<span class="badge badge-done">已整改</span>'
          : '<span class="badge badge-pending">待整改</span>'}
        <span class="meta">${formatDateTime(i.createdAt)}${i.rectifiedAt ? ' → ' + formatDateTime(i.rectifiedAt) : ''}</span>
      </div>
      <div class="photo-pair" style="max-width:560px">
        <div class="photo-slot">
          <span class="tag tag-problem">问题照片</span>
          <img src="${imgUrl(i.photoFile)}" data-zoom="${imgUrl(i.photoFile)}" alt="问题">
        </div>
        <div class="photo-slot">
          ${i.rectifyFile
            ? `<span class="tag tag-fix">整改照片</span>
               <img src="${imgUrl(i.rectifyFile)}" data-zoom="${imgUrl(i.rectifyFile)}" alt="整改">`
            : '<div class="photo-empty">⏳ 等待员工上传整改照片</div>'}
        </div>
      </div>
      ${i.remark ? `<div class="issue-remark">📝 ${escapeHtml(i.remark)}</div>` : ''}
    </div>`)
    .join('');
}

qs('#employeeList').addEventListener('click', (e) => {
  const zoom = e.target.dataset.zoom;
  if (zoom) return showLightbox(zoom);
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const id = Number(toggle.dataset.toggle);
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderList();
  }
});

qs('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

boot();
