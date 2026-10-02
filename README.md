# 保洁外包考核站

零数据库依赖的保洁外包质量考核小系统：甲方管理员登记问题照片与扣分，外包员工扫码上传整改照片，外包老板在汇总页按员工查看「问题图 / 整改图」图片对、总扣分与整改进度。

## 角色与流程

| 角色 | 入口 | 能做什么 |
|---|---|---|
| 甲方管理员 | `/`（admin / admin123） | 维护外包员工、生成/重置整改二维码与链接、上传问题照片与扣分、查看整改回填 |
| 外包员工 | 微信/浏览器扫描专属二维码 `/e/<token>` | 查看本人问题照片与扣分、拍照上传整改照片（无需账号密码） |
| 外包老板 | `/` 切换身份（boss / boss123） | 按员工查看图片对、总扣分、待整改数、整改进度（每分钟自动刷新） |

## 快速开始

```bash
npm install
npm start          # http://localhost:3000
# 自定义端口： PORT=8080 npm start
```

手机访问时把 `localhost` 换成电脑局域网 IP；部署到 HTTPS 域名后二维码自动使用该域名（支持 `X-Forwarded-Proto` 反代头）。

## 三类异常的明确提示

1. **链接过期 / 无效**：员工链接为 HMAC 签名 token，含过期时间与版本号。
   - 过期 → 跳转页与接口都提示「该整改链接已于 X 时间过期，请联系管理员重新生成」（HTTP 410）。
   - 被篡改 / 残缺 → 「链接签名校验失败，请扫描原始二维码」（403）。
   - 管理员点击「重置链接」→ 旧二维码立即失效，提示「该链接已被重新生成，请扫描最新二维码」。
   - 员工端剩余 ≤3 天时显示橙色到期提醒。
2. **图片过大**：单张上限 5MB，请求体上限 12MB。
   - 前端选图时提示大小，并自动用 Canvas 压缩（最长边 1600px、逐级降质）后上传；
   - 服务端按文件头魔数校验真实类型（JPG/PNG/WEBP/GIF），超限返回
     `IMAGE_TOO_LARGE（413，含实际大小与上限）` / `PAYLOAD_TOO_LARGE（413）`，页面 toast 明确说明。
3. **token / 登录错误**：密码错误、身份选错、会话过期、越权访问、无凭证看图等均返回
   中文错误码与可读提示（`BAD_CREDENTIALS` / `UNAUTHORIZED` / `FORBIDDEN` / `NO_TOKEN` …）。

## 安全要点

- 密码使用 `scrypt + 随机盐` 存储；会话为内存 HttpOnly Cookie（12 小时）。
- 上传图片必须携带管理员会话或有效员工 token，且服务端校验魔数后重命名落盘，拒绝伪造扩展名与路径穿越。
- 员工 token 只能操作本人的问题；管理接口按角色隔离（管理员不能访问老板汇总，反之亦然）。

## 目录结构

```
server.js            # HTTP 服务、路由、上传校验、统计接口
lib/store.js         # JSON 文件存储（原子写入）、密码哈希
lib/auth.js          # 会话、HMAC 员工链接签名/验签
public/              # 登录页 / 管理员页 / 员工页 / 老板汇总页（原生 JS）
data/db.json         # 运行时数据（自动生成，已 gitignore）
data/uploads/        # 问题与整改照片（已 gitignore）
```

## 主要接口

- `POST /api/login`、`POST /api/logout`、`GET /api/me`
- 管理员：`GET/POST /api/admin/employees`、`POST /api/admin/employees/:id/reset-link`、
  `GET .../link`、`PUT /api/admin/settings`、`POST /api/admin/upload-image`、
  `GET/POST /api/admin/issues`
- 员工（cookie 或 `?token=`）：`GET /api/employee/me`、
  `POST /api/employee/upload-image`、`POST /api/employee/issues/:id/rectify`
- 老板：`GET /api/boss/summary`
- 图片：`GET /uploads/<name>`（会话或员工 token 鉴权）
