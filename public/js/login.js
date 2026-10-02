let role = 'admin';

function syncRole() {
  qs('#roleAdmin').classList.toggle('active', role === 'admin');
  qs('#roleBoss').classList.toggle('active', role === 'boss');
  qs('#defaultHint').innerHTML =
    role === 'admin'
      ? '默认账号 <b>admin / admin123</b>，登录后请及时修改密码。'
      : '老板默认账号 <b>boss / boss123</b>，用于查看汇总，账号只读。';
}

qs('#roleAdmin').addEventListener('click', () => { role = 'admin'; syncRole(); });
qs('#roleBoss').addEventListener('click', () => { role = 'boss'; syncRole(); });
syncRole();

qs('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = qs('#username').value.trim();
  const password = qs('#password').value;
  if (!username || !password) return toast('请输入账号和密码', 'warn');
  const btn = qs('#loginBtn');
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    if (data.role !== role) {
      toast(`该账号身份为「${data.role === 'admin' ? '甲方管理员' : '老板'}」，正在跳转对应页面`, 'warn');
    } else {
      toast('登录成功', 'success', 1200);
    }
    setTimeout(() => {
      location.href = data.role === 'admin' ? '/admin.html' : '/boss.html';
    }, 500);
  } catch (err) {
    toast(err.message, 'error', 4000);
    btn.disabled = false;
    btn.textContent = '登 录';
  }
});

// 已登录直接跳转
(async () => {
  try {
    const me = await api('/api/auth/me');
    location.href = me.role === 'admin' ? '/admin.html' : '/boss.html';
  } catch (e) { /* 未登录，停留在登录页 */ }
})();
