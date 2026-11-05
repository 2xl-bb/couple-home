# 云环境中的 Railway CLI

固定版本：5.71.0，Linux x86_64。适用于继承了 HTTP_PROXY / HTTPS_PROXY 和 CA 信任的 Codex 云环境。
CLI 的 npm postinstall 使用的下载客户端没有正确采用当前环境代理时，可能报 GitHub DNS 错误。
这种情况下使用官方 Release 和 curl，不需要更换 npm 镜像、调用 GitHub API 或关闭 TLS 校验。

## 安装

从仓库根目录执行：

```sh
set -eu
mkdir -p .sites-runtime/deploy-tools/bin
railway_archive="$(mktemp /tmp/railway-cli-v5.71.0.XXXXXX)"
trap 'rm -f "$railway_archive"' EXIT
curl --proto '=https' --tlsv1.2 --fail --show-error --location \
  'https://github.com/railwayapp/cli/releases/download/v5.71.0/railway-v5.71.0-x86_64-unknown-linux-musl.tar.gz' \
  --output "$railway_archive"
printf '%s  %s\n' '2e682fd2ddf8d6fdf9e46d9d99d99646ff0022a6abb0c2bca93011348a269fb9' "$railway_archive" | sha256sum --check -
test "$(tar -tzf "$railway_archive")" = railway
tar -xzf "$railway_archive" -C .sites-runtime/deploy-tools/bin railway
chmod 700 .sites-runtime/deploy-tools/bin/railway
.sites-runtime/deploy-tools/bin/railway --version
```

这里的 SHA256 来自本任务已通过受信任 HTTPS 下载的同一官方版本。若上游同版本资产发生变化而校验失败，
应重新调查官方发布，不能删掉校验或随意替换期望值。不要移除环境代理、不要关闭证书验证。

## 授权与部署

1. 先核实当前运行实例允许 `railway.com`、`backboard.railway.com` 和 `*.up.railway.app`。
   配置草稿、已发布版本和正在运行的实例可能不同，最终以实际请求为准。
2. 执行 `.sites-runtime/deploy-tools/bin/railway whoami` 检查现有登录。
   未登录时执行 `.sites-runtime/deploy-tools/bin/railway login --browserless`，使用它刚生成的官方授权链接。
   用户在浏览器完成授权，不在聊天中提供密码或 API Token。过期后重新生成设备码。
3. 授权后先只读确认工作区、实际套餐、已有项目和用量，再创建或复用目标服务。
   保持 Free/Trial 允许的资源范围，不升级套餐、不绑定付款方式、不创建付费附加服务。
4. 按 README.md 设置一个服务、一个挂载至 `/persist` 的持久卷、HTTPS 域名、PORT=3000、
   APP_ORIGIN 和 `/healthz`。Railway 当前新服务不能采用已弃用的旧 Config as Code 模板。
5. `pnpm run build:node` 后运行 `node deploy/railway/pack.mjs`，只上传它打印的部署目录。
   如该目录被源仓库 gitignore 排除，可仅针对这个经过白名单打包的目录使用
   `railway up DIRECTORY --path-as-root --no-gitignore`，并用准确项目、服务和环境 ID 定位。
   绝对不要对整个工作区使用该选项上传。
6. 等待真实部署成功并验收 HTTPS、访问权限、持久化及备份恢复，才报告公网网站可用。

CLI 登录状态和 Token 不属于可提交的部署代码。`deploy/railway/` 是需要进仓库的部署源文件；
`.sites-runtime/` 中的工具、构建目录、归档和运行状态继续保持忽略。
