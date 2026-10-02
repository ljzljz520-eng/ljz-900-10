/* ================= 初始化与会话 ================= */
let employees = [];
let settings = { tokenTTLHours: 72 };

async function boot() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (e) {
    location.href = '/login.html';
    return;
  }
  qs('#userName').textContent = me.displayName + '（' + me.username + '）';
  if (me.role !== 'admin') {
    toast('当前账号为老板（只读），跳转汇总页', 'warn');
    setTimeout(() => (location.href = '/boss.html'), 800);
    return;
  }
  bindTabs();
  bindEvents();
  await refreshAll();
}

function bindTabs() {
  qs('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    qsa('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    qsa('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab));
    if (tab.dataset.tab === 'dashboard') loadDashboard();
    if (tab.dataset.tab === 'links') loadLinks();
    if (tab.dataset.tab === 'records') loadRecords();
    if (tab.dataset.tab === 'employees') loadEmployees();
  });
}

async function refreshAll() {
  await Promise.all([loadEmployees(), loadSettings()]);
  await Promise.all([loadRecords(), loadLinks(), loadDashboard()]);
}

/* ================= 录入考核 ================= */

function renderEmployeeOptions(selectEl, withAll = false) {
  const current = selectEl.value;
  selectEl.innerHTML =
    (withAll ? '<option value="">全部员工</option>' : '<option value="">请选择员工</option>') +
    employees
      .filter((e) => e.active)
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.employeeNo ? '（' + escapeHtml(e.employeeNo) + '）' : ''}</option>`)
      .join('');
  if (current) selectEl.value = current;
}

let selectedPhoto = null;
qs('#issuePhoto').addEventListener('change', () => {
  const file = qs('#issuePhoto').files[0];
  const hint = qs('#photoHint');
  if (!file) {
    selectedPhoto = null;
    qs('#previewWrap').style.display = 'none';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    toast('仅支持 JPG / PNG / WEBP / GIF 格式的图片', 'error');
    qs('#issuePhoto').value = '';
    return;
  }
  selectedPhoto = file;
  if (file.size > 5 * 1024 * 1024) {
    hint.innerHTML = `图片 <b style="color:var(--warn)">${humanSize(file.size)}</b>，提交时将自动压缩到 5MB 以内。`;
  } else {
    hint.innerHTML = `图片大小 ${humanSize(file.size)}，符合要求。`;
  }
  qs('#previewImg').src = URL.createObjectURL(file);
  qs('#previewWrap').style.display = 'block';
});

qs('#issueForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const employeeId = qs('#issueEmployee').value;
  const deductionItem = qs('#issueItem').value.trim();
  const points = Number(qs('#issuePoints').value);
  const remark = qs('#issueRemark').value.trim();

  if (!employeeId) return toast('请选择员工', 'warn');
  if (!deductionItem) return toast('请填写扣分项', 'warn');
  if (!Number.isFinite(points) || points <= 0) return toast('扣分分值必须是正数', 'warn');
  if (!selectedPhoto) return toast('请选择问题照片', 'warn');

  const btn = qs('#submitIssueBtn');
  btn.disabled = true;
  btn.textContent = '压缩并上传中…';
  try {
    const { file: uploadFile, compressed } = await compressImage(selectedPhoto);
    if (compressed) toast(`图片已自动压缩（${humanSize(selectedPhoto.size)} → ${humanSize(uploadFile.size)}）`, 'success', 4000);
    const fd = new FormData();
    fd.append('employeeId', employeeId);
    fd.append('deductionItem', deductionItem);
    fd.append('points', String(points));
    fd.append('remark', remark);
    fd.append('photo', uploadFile);
    await api('/api/admin/issues', { method: 'POST', body: fd });
    toast('考核已提交 ✅', 'success');
    e.target.reset();
    selectedPhoto = null;
    qs('#previewWrap').style.display = 'none';
    qs('#photoHint').textContent = '选择图片后会显示预览；超过 5MB 将自动压缩。';
    await refreshAll();
  } catch (err) {
    if (err.code === 'FILE_TOO_LARGE') toast(err.message, 'error', 5000);
    else toast(err.message, 'error', 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交考核';
  }
});

/* ================= 员工管理 ================= */

async function loadEmployees() {
  employees = await api('/api/admin/employees?keyword=' + encodeURIComponent(qs('#empSearch').value.trim()));
  renderEmployeeOptions(qs('#issueEmployee'));
  renderEmployeeOptions(qs('#recEmployee'), true);
  renderEmpTable();
}

function renderEmpTable() {
  const allIssues = window._issues || [];
  qs('#empTbody').innerHTML = employees.length
    ? employees
        .map((e) => {
          const mine = allIssues.filter((i) => i.employeeId === e.id);
          const done = mine.filter((i) => i.status === 'rectified').length;
          const pts = mine.reduce((s, i) => s + Number(i.points || 0), 0);
          return `<tr>
            <td>${e.id}</td>
            <td><b>${escapeHtml(e.name)}</b></td>
            <td>${escapeHtml(e.employeeNo || '—')}</td>
            <td>${escapeHtml(e.phone || '—')}</td>
            <td>${e.active ? '<span class="badge badge-done">在职</span>' : '<span class="badge badge-none">停用</span>'}</td>
            <td>${mine.length} / ${done}</td>
            <td>${pts > 0 ? `<span class="badge badge-points">-${pts} 分</span>` : '0'}</td>
            <td>
              <button class="btn btn-sm" data-edit-emp="${e.id}">编辑</button>
              <button class="btn btn-sm btn-primary" data-link-emp="${e.id}">整改链接</button>
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="8"><div class="empty"><div class="icon">👥</div>暂无员工，点击「添加员工」创建</div></td></tr>';
}

qs('#addEmpBtn').addEventListener('click', () => openEmpModal(null));
qs('#empSearchBtn').addEventListener('click', loadEmployees);
qs('#empSearch').addEventListener('keydown', (e) => e.key === 'Enter' && loadEmployees());

qs('#empTbody').addEventListener('click', (e) => {
  const editId = e.target.dataset.editEmp;
  const linkId = e.target.dataset.linkEmp;
  if (editId) openEmpModal(employees.find((x) => x.id === Number(editId)));
  if (linkId) generateToken(Number(linkId));
});

function openEmpModal(emp) {
  qs('#empModalTitle').textContent = emp ? '编辑员工' : '添加员工';
  qs('#empId').value = emp ? emp.id : '';
  qs('#empName').value = emp ? emp.name : '';
  qs('#empNo').value = emp ? emp.employeeNo || '' : '';
  qs('#empPhone').value = emp ? emp.phone || '' : '';
  qs('#empActiveRow').style.display = emp ? 'block' : 'none';
  qs('#empActive').value = emp ? (emp.active ? '1' : '0') : '1';
  openModal('empModal');
}

qs('#saveEmpBtn').addEventListener('click', async () => {
  const id = qs('#empId').value;
  const name = qs('#empName').value.trim();
  if (!name) return toast('请填写员工姓名', 'warn');
  const payload = {
    name,
    employeeNo: qs('#empNo').value.trim(),
    phone: qs('#empPhone').value.trim(),
  };
  try {
    if (id) {
      payload.active = Number(qs('#empActive').value);
      await api('/api/admin/employees/' + id, { method: 'PUT', body: payload });
      toast('员工信息已更新', 'success');
    } else {
      await api('/api/admin/employees', { method: 'POST', body: payload });
      toast('员工已添加', 'success');
    }
    closeModal('empModal');
    await loadEmployees();
    await loadLinks();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ================= 考核记录 ================= */

async function loadRecords() {
  const params = new URLSearchParams();
  if (qs('#recEmployee').value) params.set('employeeId', qs('#recEmployee').value);
  if (qs('#recStatus').value) params.set('status', qs('#recStatus').value);
  window._issues = await api('/api/admin/issues?' + params.toString());
  renderRecords();
  renderEmpTable();
}

qs('#recEmployee').addEventListener('change', loadRecords);
qs('#recStatus').addEventListener('change', loadRecords);

function renderRecords() {
  const issues = window._issues || [];
  const el = qs('#recList');
  if (!issues.length) {
    el.innerHTML = '<div class="empty"><div class="icon">📋</div>暂无考核记录</div>';
    return;
  }
  el.innerHTML = issues
    .map((i) => {
      const emp = employees.find((e) => e.id === i.employeeId);
      const empName = emp ? emp.name : '员工#' + i.employeeId;
      return `<div class="issue-card" data-issue="${i.id}">
        <div class="issue-head">
          <span class="item">${escapeHtml(i.deductionItem)}</span>
          <span class="badge badge-points">-${i.points} 分</span>
          ${i.status === 'rectified'
            ? '<span class="badge badge-done">已整改</span>'
            : '<span class="badge badge-pending">待整改</span>'}
          <span class="meta">${escapeHtml(empName)} · ${formatDateTime(i.createdAt)}</span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-danger" data-del-issue="${i.id}">删除</button>
        </div>
        <div class="photo-pair" style="max-width:520px">
          <div class="photo-slot">
            <span class="tag tag-problem">问题</span>
            <img src="${imgUrl(i.photoFile)}" alt="问题照片" data-zoom="${imgUrl(i.photoFile)}">
          </div>
          <div class="photo-slot">
            ${i.rectifyFile
              ? `<span class="tag tag-fix">整改</span>
                 <img src="${imgUrl(i.rectifyFile)}" alt="整改照片" data-zoom="${imgUrl(i.rectifyFile)}">
                 <div class="small muted" style="position:absolute;bottom:6px;right:8px;background:rgba(255,255,255,.85);padding:1px 7px;border-radius:6px">${formatDateTime(i.rectifiedAt)}</div>`
              : '<div class="photo-empty">⏳ 员工尚未上传整改照片</div>'}
          </div>
        </div>
        ${i.remark ? `<div class="issue-remark">📝 ${escapeHtml(i.remark)}</div>` : ''}
      </div>`;
    })
    .join('');
}

qs('#recList').addEventListener('click', async (e) => {
  const zoom = e.target.dataset.zoom;
  if (zoom) return showLightbox(zoom);
  const id = e.target.dataset.delIssue;
  if (!id) return;
  const ok = await confirmDialog({
    title: '删除考核记录',
    text: '删除后该问题与整改照片将一并移除，且不可恢复，确定删除吗？',
    danger: true,
    confirmText: '确认删除',
  });
  if (!ok) return;
  try {
    await api('/api/admin/issues/' + id, { method: 'DELETE' });
    toast('记录已删除', 'success');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ================= 整改链接 ================= */

async function loadSettings() {
  settings = await api('/api/admin/settings');
  qs('#ttlText').textContent = settings.tokenTTLHours + ' 小时（' + (settings.tokenTTLHours / 24).toFixed(1) + ' 天）';
  qs('#ttlHours').value = settings.tokenTTLHours;
}

async function loadLinks() {
  const [tokens, stats] = await Promise.all([api('/api/admin/tokens'), api('/api/admin/stats')]);
  const now = Date.now();
  const tokenMap = new Map(tokens.map((t) => [t.employeeId, t]));
  qs('#linkTbody').innerHTML = employees
    .map((e) => {
      const t = tokenMap.get(e.id);
      const stat = stats.employees.find((s) => s.id === e.id);
      let status;
      if (!t) status = '<span class="badge badge-none">未生成</span>';
      else if (t.expiresAt <= now) status = '<span class="badge badge-expired">已过期</span>';
      else status = '<span class="badge badge-done">有效</span>';
      return `<tr>
        <td><b>${escapeHtml(e.name)}</b>${e.employeeNo ? ' <span class="small muted">' + escapeHtml(e.employeeNo) + '</span>' : ''}
          ${stat ? `<div class="small muted">整改 ${stat.rectifiedCount}/${stat.issueCount}</div>` : ''}</td>
        <td>${status}</td>
        <td>${t ? formatDateTime(t.expiresAt) : '—'}</td>
        <td class="flex">
          <button class="btn btn-sm btn-primary" data-link-emp="${e.id}">${t ? '重新生成' : '生成链接'}</button>
          ${t ? `<button class="btn btn-sm btn-danger" data-revoke="${e.id}">作废旧链接</button>` : ''}
        </td>
      </tr>`;
    })
    .join('');
}

qs('#linkTbody').addEventListener('click', async (e) => {
  const id = e.target.dataset.linkEmp;
  if (id) return generateToken(Number(id));
  const revokeId = e.target.dataset.revoke;
  if (revokeId) {
    const ok = await confirmDialog({
      title: '作废整改链接',
      text: '作废后该员工现有链接立即无法使用，需要重新生成，确定吗？',
      danger: true,
      confirmText: '确认作废',
    });
    if (!ok) return;
    await api('/api/admin/employees/' + revokeId + '/token', { method: 'DELETE' });
    toast('链接已作废', 'success');
    await loadLinks();
  }
});

async function generateToken(employeeId) {
  const emp = employees.find((x) => x.id === employeeId);
  if (!emp) return;
  try {
    const data = await api(`/api/admin/employees/${employeeId}/token`, {
      method: 'POST',
      body: { ttlHours: settings.tokenTTLHours },
    });
    qs('#linkEmpName').textContent = emp.name;
    qs('#linkQr').src = data.qr;
    qs('#linkUrl').value = data.url;
    qs('#linkExpiry').innerHTML =
      `链接有效期至 <b>${formatDateTime(data.expiresAt)}</b>（${data.ttlHours} 小时）。` +
      `<div class="small muted" style="margin-top:4px">⚠️ 重新生成后，该员工之前的旧链接会立即失效。</div>`;
    openModal('linkModal');
    await loadLinks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

qs('#copyLinkBtn').addEventListener('click', async () => {
  const input = qs('#linkUrl');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('链接已复制', 'success');
  } catch (e) {
    input.select();
    document.execCommand('copy');
    toast('链接已复制', 'success');
  }
});

/* ================= 进度看板 ================= */

async function loadDashboard() {
  const stats = await api('/api/admin/stats');
  const o = stats.overall;
  qs('#dashOverall').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="num teal">${o.employeeCount}</div><div class="label">外包员工（在职 ${o.activeCount}）</div></div>
      <div class="stat"><div class="num">${o.issueCount}</div><div class="label">问题总数</div></div>
      <div class="stat"><div class="num" style="color:var(--success)">${o.rectifiedCount}</div><div class="label">已整改</div></div>
      <div class="stat"><div class="num" style="color:var(--warn)">${o.pendingCount}</div><div class="label">待整改</div></div>
      <div class="stat"><div class="num danger">-${o.totalPoints}</div><div class="label">总扣分</div></div>
      <div class="stat">
        <div class="num teal">${o.progress}%</div>
        <div class="label">整体整改进度</div>
        <div class="progress mt-2"><span style="width:${o.progress}%"></span></div>
      </div>
    </div>`;
  qs('#dashTbody').innerHTML = stats.employees
    .map((s) => {
      const linkBadge =
        s.tokenStatus === 'valid'
          ? '<span class="badge badge-done">链接有效</span>'
          : s.tokenStatus === 'expired'
            ? '<span class="badge badge-expired">链接过期</span>'
            : '<span class="badge badge-none">未生成</span>';
      return `<tr>
        <td><b>${escapeHtml(s.name)}</b>${s.employeeNo ? ' <span class="small muted">' + escapeHtml(s.employeeNo) + '</span>' : ''}${s.active ? '' : ' <span class="badge badge-none">停用</span>'}</td>
        <td>${s.issueCount}</td>
        <td>${s.pendingCount > 0 ? `<span style="color:var(--warn);font-weight:600">${s.pendingCount}</span>` : '0'}</td>
        <td>${s.totalPoints > 0 ? `<span class="badge badge-points">-${s.totalPoints} 分</span>` : '0'}</td>
        <td>
          <div class="progress-wrap">
            <div class="progress"><span style="width:${s.progress}%"></span></div>
            <span class="pct">${s.progress}%</span>
          </div>
          <div class="small muted">${s.rectifiedCount}/${s.issueCount} 条</div>
        </td>
        <td>${linkBadge}</td>
      </tr>`;
    })
    .join('');
}

/* ================= 设置 / 密码 ================= */

qs('#ttlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const v = Number(qs('#ttlHours').value);
    settings = await api('/api/admin/settings', { method: 'PUT', body: { tokenTTLHours: v } });
    qs('#ttlText').textContent = settings.tokenTTLHours + ' 小时（' + (settings.tokenTTLHours / 24).toFixed(1) + ' 天）';
    toast('设置已保存（仅影响之后新生成的链接）', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

qs('#pwdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const oldPwd = qs('#oldPwd').value;
  const newPwd = qs('#newPwd').value;
  const newPwd2 = qs('#newPwd2').value;
  if (newPwd !== newPwd2) return toast('两次输入的新密码不一致', 'warn');
  if (newPwd.length < 6) return toast('新密码至少 6 位', 'warn');
  try {
    await api('/api/auth/change-password', { method: 'POST', body: { oldPassword: oldPwd, newPassword: newPwd } });
    toast('密码修改成功', 'success');
    e.target.reset();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ================= 退出 ================= */

function bindEvents() {
  qs('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}

boot();
