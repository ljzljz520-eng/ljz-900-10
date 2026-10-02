'use strict';

const ITEM_PRESETS = [
  '卫生间地面有污渍', '垃圾桶满溢未清运', '公区地面有明显杂物',
  '玻璃/镜面有明显水渍', '电梯轿厢有异味', '楼梯间有积尘',
  '保洁工具乱摆乱放', '消毒记录未填写', '会议室桌面未擦拭', '茶水间台面脏乱'
];

let employees = [];
let issues = [];
let linkValidDays = 30;
const uploader = createUploader({ max: 6 });

async function guard() {
  try {
    const me = await api('/api/me');
    if (me.role !== 'admin') { location.href = '/'; return null; }
    $('#who').textContent = `${me.name}（管理员）`;
    return me;
  } catch {
    location.href = '/';
    return null;
  }
}

async function loadEmployees() {
  const r = await api('/api/admin/employees');
  employees = r.employees;
  linkValidDays = r.linkValidDays;
  $('#linkDays').value = linkValidDays;
  renderEmployees();
  renderEmpOptions();
}

async function loadIssues() {
  const r = await api('/api/admin/issues');
  issues = r.issues;
  renderIssues();
}

function renderEmpOptions() {
  const opts = '<option value="">— 选择外包员工 —</option>' +
    employees.map(e => `<option value="${e.id}">${esc(e.name)}${e.employeeNo ? '（' + esc(e.employeeNo) + '）' : ''}</option>`).join('');
  $('#fEmp').innerHTML = opts;
  $('#filterEmp').innerHTML = '<option value="">全部员工</option>' +
    employees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
}

function empExpireState(ts) {
  const left = ts - Date.now();
  if (left <= 0) return `<span class="badge red">已过期</span>`;
  const days = Math.ceil(left / 86400000);
  return days <= 3
    ? `<span class="badge pending">${days} 天后过期</span>`
    : `<span class="badge gray">有效期 ${days} 天</span>`;
}

function renderEmployees() {
  if (!employees.length) {
    $('#empList').innerHTML = '<div class="empty"><div class="big">👷</div>还没有员工，先在上方添加。</div>';
    return;
  }
  $('#empList').innerHTML = employees.map(e => `
    <div class="issue" style="margin-bottom:10px">
      <div class="hd">
        <div>
          <span class="tt">${esc(e.name)}</span>
          ${e.employeeNo ? `<span class="emp-chip" style="margin-left:6px">工号 ${esc(e.employeeNo)}</span>` : ''}
          ${e.phone ? `<span class="muted" style="margin-left:8px">📞 ${esc(e.phone)}</span>` : ''}
        </div>
        <div>
          ${empExpireState(e.linkExpiresAt)}
          <button class="btn sec sm" data-act="qr" data-id="${e.id}">查看二维码</button>
          <button class="btn danger sm" data-act="reset" data-id="${e.id}">重置链接</button>
        </div>
      </div>
      <div class="meta">创建于 ${fmtDate(e.createdAt)}　链接到期：${fmtDate(e.linkExpiresAt)}</div>
    </div>`).join('');
}

function renderIssues() {
  const fEmp = $('#filterEmp').value;
  const fStatus = $('#filterStatus').value;
  const list = issues.filter(i =>
    (!fEmp || i.empId === fEmp) &&
    (!fStatus || (fStatus === 'done' ? i.rectify.at : !i.rectify.at)));
  if (!list.length) {
    $('#issueList').innerHTML = '<div class="empty"><div class="big">📋</div>暂无符合条件的考核记录。</div>';
    return;
  }
  $('#issueList').innerHTML = list.map(i => {
    const done = !!i.rectify.at;
    return `
    <div class="issue">
      <div class="hd">
        <div>
          <span class="tt">${esc(i.item)}</span>
          <span class="emp-chip" style="margin-left:8px">${esc(i.empName)}</span>
        </div>
        <div>
          <span class="points">-${i.points} 分</span>
          ${done ? '<span class="badge done" style="margin-left:10px">已整改</span>' : '<span class="badge pending" style="margin-left:10px">待整改</span>'}
        </div>
      </div>
      ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}
      <div class="photo-pair" style="margin-top:10px">
        <div class="col">
          <div class="cap">🔴 问题照片（甲方拍摄）<span class="meta">${fmtDate(i.createdAt)}</span></div>
          ${photoGrid(i.photos)}
        </div>
        <div class="col">
          <div class="cap">🟢 整改照片（员工上传）</div>
          ${done
            ? `${photoGrid(i.rectify.photos)}<div class="meta" style="margin-top:6px">整改人：${esc(i.rectify.byName)} ｜ ${fmtDate(i.rectify.at)}${i.rectify.note ? ' ｜ ' + esc(i.rectify.note) : ''}</div>`
            : '<div class="muted" style="padding:10px 0">员工扫码后在此上传整改照片</div>'}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---- 二维码弹窗 ----
async function openQr(empId) {
  try {
    const r = await api(`/api/admin/employees/${empId}/link`);
    $('#qrTitle').textContent = '员工整改二维码';
    $('#qrEmp').textContent = `${r.employee.name}${r.employee.employeeNo ? '（工号 ' + r.employee.employeeNo + '）' : ''}`;
    $('#qrImg').src = r.link.qrDataUrl;
    $('#qrLink').textContent = r.link.url;
    $('#qrExp').innerHTML = r.link.expiresAt > Date.now()
      ? `有效期至 <b>${fmtDate(r.link.expiresAt)}</b>`
      : '<b style="color:var(--danger)">链接已过期，请点击“重置链接”重新生成</b>';
    $('#qrModal').dataset.url = r.link.url;
    $('#qrModal').classList.add('show');
  } catch (e) { toast(e.message, 'err'); }
}

// ---- 事件绑定 ----
document.addEventListener('DOMContentLoaded', async () => {
  if (!await guard()) return;
  $('#itemPresets').innerHTML = ITEM_PRESETS.map(x => `<option value="${esc(x)}">`).join('');
  $('#fUploader').appendChild(uploader.el);

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  $('#saveDays').addEventListener('click', async () => {
    const days = Number($('#linkDays').value);
    try {
      const r = await api('/api/admin/settings', { method: 'PUT', body: { linkValidDays: days } });
      linkValidDays = r.linkValidDays;
      toast('默认链接有效期已保存', 'ok');
    } catch (e) { toast(e.message, 'err', 4500); $('#linkDays').value = linkValidDays; }
  });

  $('#empForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/employees', {
        method: 'POST',
        body: {
          name: $('#eName').value,
          employeeNo: $('#eNo').value,
          phone: $('#ePhone').value
        }
      });
      toast('员工已添加，二维码已生成', 'ok');
      e.target.reset();
      await loadEmployees();
      openQr(r.employee.id);
    } catch (err) { toast(err.message, 'err', 4500); }
    btn.disabled = false;
  });

  $('#empList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'qr') return openQr(id);
    if (b.dataset.act === 'reset') {
      if (!confirm('重置后，该员工旧的二维码/链接会立即失效，需要重新扫码。确定重置吗？')) return;
      try {
        const r = await api(`/api/admin/employees/${id}/reset-link`, { method: 'POST', body: {} });
        toast('链接已重置，旧二维码已失效', 'ok');
        await loadEmployees();
        $('#qrImg').src = r.link.qrDataUrl;
        $('#qrLink').textContent = r.link.url;
        $('#qrExp').innerHTML = `新链接有效期至 <b>${fmtDate(r.link.expiresAt)}</b>`;
        const emp = employees.find(x => x.id === id);
        $('#qrEmp').textContent = emp ? `${emp.name}${emp.employeeNo ? '（工号 ' + emp.employeeNo + '）' : ''}` : '';
        $('#qrModal').dataset.url = r.link.url;
        $('#qrModal').classList.add('show');
      } catch (err) { toast(err.message, 'err', 4500); }
    }
  });

  $('#closeQr').addEventListener('click', () => $('#qrModal').classList.remove('show'));
  $('#qrModal').addEventListener('click', e => { if (e.target.id === 'qrModal') $('#qrModal').classList.remove('show'); });
  $('#copyLink').addEventListener('click', async () => {
    const url = $('#qrModal').dataset.url || '';
    try { await navigator.clipboard.writeText(url); toast('整改链接已复制', 'ok'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast('整改链接已复制', 'ok');
    }
  });

  $('#issueForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('#fEmp').value) return toast('请选择考核员工', 'err');
    if (!$('#fItem').value.trim()) return toast('请填写扣分项', 'err');
    if (!uploader.urls.length) return toast('请至少上传 1 张问题现场照片', 'err');
    const btn = $('#issueSubmit');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      await api('/api/admin/issues', {
        method: 'POST',
        body: {
          empId: $('#fEmp').value,
          item: $('#fItem').value.trim(),
          points: Number($('#fPoints').value),
          note: $('#fNote').value.trim(),
          photos: uploader.urls.slice()
        }
      });
      toast('考核记录已提交，员工可扫码查看整改', 'ok');
      e.target.reset();
      uploader.reset();
      await loadIssues();
    } catch (err) { toast(err.message, 'err', 5000); }
    btn.disabled = false; btn.textContent = '提交考核记录';
  });

  $('#filterEmp').addEventListener('change', renderIssues);
  $('#filterStatus').addEventListener('change', renderIssues);

  try {
    await Promise.all([loadEmployees(), loadIssues()]);
  } catch (err) {
    toast('加载数据失败：' + err.message, 'err', 5000);
  }
});
