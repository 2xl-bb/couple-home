# 我们的小日子 · Couple Home

一个只属于两个人的私密小屋：把日常记下来，实时一起玩一局，把一起去过的地方点亮在地图上。代码开源，数据可以完整放在自己手里。

> 本项目在 [liu7866/couple-home](https://github.com/liu7866/couple-home)（MIT）基础上继续开发，保留原有的双人登录、备份与安全设计，新增「行舟记」旅行足迹地图、双人实时真心话大冒险、相册时间线与 AI 整理、照片 GPS、PWA 离线等能力。原创代码仍采用 MIT 许可，第三方依赖见文末。

## 功能

**一起记录**：双人密码登录、恋爱天数、纪念日、故事时间线、心愿、独立心情、私密相册、留言与未来信、每日双人问答（双方都答完才揭晓）、约会灵感罐、双人日历、专属小券、个人偏好档案、可下载的离线月度回忆册。

**实时一起玩**：双人骰子「真心话大冒险」，内置与自定义题库、答题提交、微信式对局聊天（显示发送中、失败可重试）、大冒险待办清单。用 SSE 取代轮询同步对局与聊天状态，并对聊天与操作限频；异地或作息不同，也可以一人先点、另一人随后接上。

**相册**：最多保存 5,000 张照片，一次最多选择 20 张；时间线浏览、按拍摄时间排序，读取 EXIF 拍摄时间与 GPS，也能手动在地图上选点。支持按备注搜索、按月份浏览。可选接入 AI 自动分类、标签与语义搜索；不配置 AI 时相关入口自动隐藏，其余功能照常。配置方法与数据发送范围见[相册 AI 配置](deploy/相册AI配置.md)。

**行舟记 · 旅行足迹地图**：见下一节。

**随时可用**：PWA 可添加到手机主屏，Service Worker 缓存静态资源并在断网时给出离线提示；移动端底部导航适配，`/healthz` 供反向代理与部署平台做健康检查。

## 行舟记 · 旅行足迹地图

![行舟记启动页](public/travel/screenshot.png)

从 `/travel/` 进入，也可从移动端导航或房间选择器跳转。它是带独立 manifest 与 Service Worker 的子应用：

- 在地图上点亮去过的地点，可自动定位并填地址，也可手动选点；支持足迹连线、足迹本，以及每个足迹下多张照片。
- 成就系统与隐藏彩蛋；可生成 PNG 足迹海报下载分享，也能把旅行计划整理成可复制的攻略。
- 数据先存本地 IndexedDB，联网后与 `/api/travel/footprints` 同步；断网时先留在设备，恢复后自动补传。足迹照片写入对象存储（云端版为 R2 私有桶），要求 JPEG 且不超过 1 MB。
- 详细操作见[使用指南](public/travel/使用指南.html)。启动页文案、落款、信件与彩蛋词都写在 `public/travel/index.html`，换成自己的内容不需要改后端。

## 最近更新（2026-11）

- 新增「行舟记」足迹地图：本地 Leaflet 资源与标记聚合、EXIF GPS、手动选点、多照片、成就与海报、离线与云同步。
- 新增双人实时真心话大冒险：骰子、自定义题库、答题、对局聊天与待办；SSE 实时同步与限频。
- 相册升级为时间线／拍摄时间排序、照片位置、5,000 张容量，并加入可选 AI 分类与语义搜索。
- 双成员云同步、足迹照片对象存储、PWA 离线与移动端导航；数据库迁移推进到 `0013`。
- 纪念日、备份恢复、密码与恢复码机制继续保留；`room_state` 中的宠物字段仅为兼容旧备份保留，前端已不再加载或展示宠物模块。

仓库自带测试，常用入口是 `pnpm run test:node`；修改共享逻辑前应同时构建两种版本并运行 `tests/*.test.mjs`。历史回归记录见[验证结果](deploy/node/验证结果.md)，对应较早版本，新增模块请以源码与测试为准。

## 快速开始（独立 Node.js 版）

独立版不需要 ChatGPT 登录、D1 或 R2，适合自己的电脑及阿里云 / Linux 服务器。需要 Node.js 22.18 或更新版本，以及 pnpm 11.25.0。

```sh
git clone https://github.com/2xl-bb/couple-home.git
cd couple-home
pnpm install --frozen-lockfile
pnpm run build:node
pnpm run test:node
pnpm run start:node
```

打开 http://127.0.0.1:3000，首次页面设置两位成员密码；成员一拥有管理员权限，创建后自动进入小屋设置。原有小屋不能再次初始化覆盖数据。足迹地图在 http://127.0.0.1:3000/travel/，手机浏览器可「添加到主屏」；`/healthz` 不返回私人数据。

构建得到的 `dist-node/` 可单独部署，运行时不需要安装依赖，其中包含 `public/travel/` 静态资源。公网 HTTPS 首次创建需要部署者提供初始化码，具体见部署说明。

- [部署方式总览](deploy/README.md)
- [阿里云 / Linux 部署](deploy/node/部署说明.md)
- [Cloudflare 接入及 Workers 限制](deploy/cloudflare.md)
- [自己的电脑 + Cloudflare Tunnel](deploy/cloudflare-tunnel.md)
- [使用 AI 工具协助部署](deploy/AI工具部署指南.md)
- [本地使用与迁移](本地使用说明.md)
- [验证记录](deploy/node/验证结果.md)

默认 SQLite 数据库、照片和备份保存在 `dist-node/data/`、`dist-node/backups/`。正式服务器应配置独立的持久化路径并定期校验备份，不要将真实数据提交到仓库。

## 自定义与二次开发

想换网站名称、配色，或修改相册、足迹与互动玩法规则，先看[自定义修改指南](自定义修改指南.md)。指南包含设置入口、源码位置、修改示例、独立测试数据预览和验证命令；其中部分数值（如相册容量）写于较早版本，请以源码为准。

新增模块的主要位置：

| 修改目标 | 主要文件 |
| --- | --- |
| 真心话题库、对局与待办交互 | `public/features.js`、`lib/truth-dare-games.ts`、`app/api/games/truth-dare/` |
| 实时同步（SSE） | `lib/truth-dare-stream.ts`、`app/api/games/truth-dare/stream/route.ts` |
| 行舟记页面、文案与彩蛋 | `public/travel/index.html` |
| 足迹数据与照片接口 | `app/api/travel/footprints/`、`server/r2-video.mjs`、`drizzle/0009_*.sql` |
| 相册时间线、EXIF 与选点 | `public/album.js`、`public/app.js`、`app/api/photos/route.ts` |
| 相册 AI 分类与语义搜索 | `lib/album-ai.mjs`、`app/api/album-ai/route.ts`、`app/api/album-search/route.ts` |
| PWA 离线与图标 | `public/manifest.json`、`public/sw.js`、`public/travel/manifest.json` |

修改源码后需要重新构建、部署才能让自己的站点生效；新增字段或接口时要补迁移，并同步检查导出与恢复流程。

## Render + Supabase + R2

云端版让 Render 运行 Node.js 服务，Neon PostgreSQL 保存记录和 Session，Supabase 私有 Storage 保存压缩后的 JPEG，Cloudflare R2 私有桶保存视频与足迹照片。Render 本地磁盘不保存唯一数据。构建与验证命令：

```sh
pnpm install --frozen-lockfile
pnpm run build:supabase
node --test tests/postgres-adapter.test.mjs tests/supabase-storage.test.mjs tests/r2-video.test.mjs tests/media-auth.test.mjs
```

Render 使用 `process.env.PORT` 并监听 `0.0.0.0`，健康检查路径为 `/healthz`。`DATABASE_URL` 支持 Neon Pooler 或 Supabase Transaction Pooler，并且必须启用 TLS。完整环境变量、R2 CORS 和部署步骤见 [Render/Supabase/R2 部署说明](deploy/render-supabase/README.md)。

## Sites / Cloudflare 版本（原平台）

原平台版本使用 TypeScript / Vinext / React / Cloudflare Workers / D1 / R2。管理员认证依赖 Sites 提供的可信 ChatGPT 登录网关；迁入个人 Workers 账号仍需完成独立认证适配，不能直接作为一键部署模板使用。

在 Sites 创建自己的项目时，使用该项目自己的 `.openai/hosting.json` 项目标识和 D1/R2 资源，按顺序应用 `drizzle/*.sql`，并配置自己的 `OWNER_LOGIN_EMAIL`。仓库没有预设真实项目 ID。生产环境不能信任用户伪造的身份头，详见 [SECURITY.md](SECURITY.md)。

原平台本地开发：

```sh
cp .env.example .dev.vars
pnpm dev
pnpm build
node --test tests/home-domain.test.mjs tests/home-storage.test.mjs tests/home-api.test.mjs
```

开发模拟身份只供本地使用；原平台的 `.wrangler/` 数据和独立版的 SQLite 数据相互分开。

## 可选 GitHub Pages 前端

GitHub Pages 只能托管静态前端，不能运行本仓库的数据库和后端，也无法提供足迹、实时对局等后端接口。先部署自己的 Sites 后端，并配置 `PAGES_ORIGIN` 为自己的完整 HTTPS Pages 来源，不带项目路径。

```sh
API_ORIGIN=https://YOUR_BACKEND_HOST node scripts/export-github-pages.mjs
```

将 `outputs/github-pages/` 内容发布到自己的 Pages 仓库。导出脚本必须显式指定自己的后端地址，不会默认连接维护者的小屋。私人设备可选择记住登录 30 天，退出或改密会使会话失效。

仓库代码更新不会自动更新任何人的实际服务器；新的密码、恢复码、相册容量与新增玩法规则，都需要部署相应后端后才会生效。

## 备份、恢复与安全

管理员可在网页下载完整备份，包含小屋状态、相册照片（二进制打包进 JSON）、照片备注、AI 整理结果，以及 `state.archive` 中的行舟记足迹、真心话大冒险对局／聊天／待办与视频索引；不包含登录密码、会话或恢复码。导入时独立表按记录编号合并，不删除现有记录，重复导入幂等，文字恢复与独立表写入在同一个事务里完成。

**注意**：行舟记足迹照片与共同视频只在对象存储（云端版为 R2 私有桶）中保存，备份导出的是它们的索引和 URL，不含二进制。换服务器时要一并迁移对应的存储桶，否则这些媒体仍然打不开。需要连媒体一起完整保留，请使用服务器快照（`pnpm run backup:node`）或部署平台的备份方案。

备份可能包含未到期未来信和未揭晓问答，请私下保存。恢复前先下载当前备份；照片始终合并，版本变化时会阻止覆盖，避免另一台设备的新记录丢失。

网页导出会检查照片类型和 JPEG 文件头，导入时在上传之前检查所有照片的文件头与已有校验和；这不能保证发现每一种文件损坏。网页 JSON 导入上限为 1GB，超过该大小请使用服务器快照或部署平台提供的备份方案。

个人恢复码是备用钥匙，每次使用后轮换。新码支持小写、空格和分隔线输入；旧码仍可用，重新生成后旧码失效。原有密码不会被自动更改。密码使用随机盐与 PBKDF2-SHA256（600,000 次迭代），接口保留会话校验、来源限制与尝试次数限制。

仓库只包含源码及虚构测试数据，不包含真实回忆、照片、密码哈希、恢复码、会话或云资源配置。请勿提交环境变量、密钥、数据库导出及真实相册，也不要将这些数据贴进公开 Issue。

## 贡献与许可

欢迎提交 Issue 或 Pull Request，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。原创代码采用 [MIT License](LICENSE)；上游 [liu7866/couple-home](https://github.com/liu7866/couple-home) 同为 MIT。第三方依赖和 vendor 文件继续适用各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，以及 `public/travel/LICENSE`、`public/travel/vendor/leaflet.markercluster.LICENSE`。
