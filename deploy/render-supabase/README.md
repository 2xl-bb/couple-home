# Render + Supabase + Cloudflare R2（测试部署）

这个版本让 Render 只运行网站。小屋记录、双人密码与登录会话保存在 Neon PostgreSQL（也兼容 Supabase PostgreSQL）；主站照片保存在 Supabase Storage 私有桶；视频与行舟记足迹照片保存在 Cloudflare R2 私有桶。Render 临时磁盘不承载需要保留的数据。媒体属于共同小屋，两位已登录成员都能读取和删除；未登录访客不能读取。

## 部署前

1. 在 Supabase 新建免费项目。创建 **私有** Storage bucket `couple-photos`，关闭 Public bucket，建议限制 JPEG 和单文件 5 MB。不要在 Storage 中添加允许匿名读取的策略。
2. 从 Neon 取得 PostgreSQL Pooler 连接地址（或使用 Supabase Transaction Pooler `:6543`），并在连接串中保留 `sslmode=require`（也接受 `verify-full`）。填入 Render 的 `DATABASE_URL`。密码中 `@`、`#`、`/` 等字符要按 URL 规则编码。本项目不使用命名 prepared statement，适合事务连接池。
3. 在 Supabase **API Keys** 中取得新的 `sb_secret_...` 服务端密钥，填入 Render 的 `SUPABASE_SECRET_KEY`。旧项目也可使用 `SUPABASE_SERVICE_ROLE_KEY`（旧版 service_role JWT）。这两类密钥只能留在 Render 环境变量中，不能放进浏览器、Git 或截图。
4. 为首次入住生成一个独立的、至少 24 字符的 `SETUP_CODE`，只通过私密渠道交给两位成员。它不是登录密码。首次设置完成后，数据库中的双人密码和会话不依赖 Render 本地文件。
5. 在 Cloudflare R2 创建私有桶，不绑定公开域名。创建只允许该桶对象读写的 R2 API Token，保存 Account ID、Access Key ID 和 Secret Access Key。
6. 给 R2 桶设置 CORS，把 `https://你的服务.onrender.com` 替换为真实 Render 来源：

```json
[
  {
    "AllowedOrigins": ["https://你的服务.onrender.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedOrigins` 必须与 `APP_ORIGIN` 完全一致，不带末尾斜线。浏览器通过预签名 URL 直接上传和播放视频；服务端生成的 CSP 会只放行当前 `R2_BUCKET_NAME` 与 `R2_ACCOUNT_ID` 对应的私有 R2 域名。

数据库建表由应用首次启动执行。`schema.sql` 为初始迁移，部署后不要直接修改；后续升级由 `migrations/` 中带校验哈希的增量迁移按顺序自动执行。照片追加留言使用 `0002_photo_captions.sql`，行舟记云端同步使用 `0005_travel_footprints.sql`，真心话大冒险的回答流程使用 `0007_truth_dare_answers.sql`，原 `photos.caption` 保留为不可覆盖的原配文。数据库表明确拒绝 Supabase Data API 的 `anon` 和 `authenticated` 角色访问。

## Render 设置

连接自己的 GitHub 仓库，创建 **Web Service**，选择 Free 实例。Node 版本使用 24。把根目录留在仓库根目录。

| 设置 | 值 |
| --- | --- |
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm run build:supabase` |
| Start Command | `node dist-supabase/server.mjs` |
| Health Check Path | `/healthz` |

| 环境变量 | 用途 |
| --- | --- |
| `NODE_VERSION` | `24` |
| `APP_ORIGIN` | Render 给出的完整 `https://...onrender.com` 地址，**无末尾斜线** |
| `DATABASE_URL` | Neon Pooler 或 Supabase Transaction Pooler 的 TLS 连接串 |
| `SUPABASE_URL` | Supabase 项目根地址，形如 `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 旧版 `service_role` 服务端密钥；也可改用下面的新密钥 |
| `SUPABASE_SECRET_KEY` | 推荐的新 `sb_secret_...` 服务端密钥；二者配置一个即可 |
| `SETUP_CODE` | 首次设置用的随机长码 |
| `SUPABASE_BUCKET` | 可省略，默认 `couple-photos` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID（32 位十六进制） |
| `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret Access Key |
| `R2_BUCKET_NAME` | 私有视频桶名称 |

行舟记将压缩后的 JPEG 由服务端写入同一个私有 R2 桶，Neon 只保存受登录保护的同源照片 URL；不需要公开 R2 域名或额外浏览器 CORS 规则。R2 Token 需要有该桶对象的读、写、删权限。已有本地 IndexedDB 足迹会在成员登录且云端可用时自动迁移；两位成员可共享、更新并删除这份足迹列表。

`PORT` 由 Render 提供，应用默认监听 `0.0.0.0`。不要把本地的 `HTTPS_PROXY`、`NODE_USE_ENV_PROXY` 或 Clash 地址复制到 Render。无需 `SESSION_SECRET`：现有登录会话的随机令牌以哈希形式存在数据库中。AI 相册整理是可选功能；不配置相应 API 变量就不会发送照片给 AI 服务。

## 上线前验收

先用空白测试小屋和非私人测试文件。两位成员分别设置密码并登录。成员一上传照片和视频后，成员二必须能在同一时间线看到、读取和播放，也能从共同相册移除；未登录请求仍须返回 401。再测试上传、播放、删除、Render 重启和重新部署。用管理员账号下载“完整备份”，确认双方照片都在备份 JSON 内并验证导入。视频当前不包含在网页 JSON 备份中，需要另行从 R2 做备份。最后检查仓库无密钥、真实媒体、SQLite 数据库文件。

完整备份是浏览器逐张下载当前成员照片后生成的 JSON；原有 `backup:node` 命令只适用于本地 SQLite 版，不能用作云端备份。R2 视频不进入 JSON，以免浏览器把大视频全部载入内存。请给视频建立单独的 R2 复制或下载备份流程。Supabase Free 不提供可依赖的自动数据库备份，建议每周在私人电脑下载一次完整备份并定期验证恢复。

## 免费层限制

Render Free 闲置后会休眠，重启或部署会清空本地文件。Supabase Free 项目也可能因低活动暂停，额度、保留政策和免费计划以后可能变化；使用前以 [Render 官方免费服务说明](https://render.com/docs/free)、[Supabase 免费计划](https://supabase.com/pricing)、[Supabase 项目暂停说明](https://supabase.com/docs/guides/platform/free-project-pausing) 为准。不要把云端免费计划当作唯一备份。
