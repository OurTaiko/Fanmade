# 前端自动部署

`.github/workflows/deploy.yml` 在每次推送 `main` 时运行，也可以在 GitHub
Actions 的 **Deploy frontend → Run workflow** 中选择 `main` 手动重试。
其他分支不会部署。

流程先检出本次提交及 TJARenderer 子模块，使用 Node.js 24 和
`package.json` 指定的 pnpm，依次执行冻结锁文件安装、lint、单元测试和生产构建。
全部通过后，使用 SSH 密码认证调用本次提交里的 `deploy/publish.sh`。
服务器拉取并再次构建同一提交，然后把 1Panel 站点的 `index` 链接切换到完整的
`releases/<commit SHA>` 目录。切换成功后只保留当前版本和最近的其他版本，共 5 个，
更早的 `releases/<commit SHA>` 目录会被删除；保留现有手动发布方式。

## GitHub Secrets

在 [前端仓库的 Actions Secrets 设置](https://github.com/OurTaiko/Fanmade_Frontend/settings/secrets/actions)
选择 **New repository secret**，逐项添加：

| Secret               | 必填 | 内容                                                                             |
| -------------------- | ---- | -------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | 是   | 服务器公网 IP 或 SSH 域名，不带 `https://`                                       |
| `DEPLOY_USER`        | 是   | SSH 登录用户名                                                                   |
| `DEPLOY_PASSWORD`    | 是   | 对应用户的 SSH 登录密码                                                          |
| `DEPLOY_FINGERPRINT` | 是   | SSH 主机公钥的 SHA256 指纹，包含 `SHA256:` 前缀                                  |
| `DEPLOY_PORT`        | 否   | SSH 端口，默认 `22`                                                              |
| `DEPLOY_BASE_PATH`   | 否   | 应用根目录，默认 `/opt/ourtaiko-fanmade`；源码位于其 `src/frontend`              |
| `DEPLOY_SITE_PATH`   | 否   | 1Panel 站点目录，默认 `/opt/1panel/www/sites/fanmade.ourtaiko.org`               |
| `DEPLOY_GIT_REMOTE`  | 否   | **服务器上**的 Git 远端名，默认 `origin`；如服务器使用 `ourtaiko`，填 `ourtaiko` |

通过已信任的服务器控制台或 SSH 会话获取主机指纹：

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub -E sha256
```

复制输出的第二列 `SHA256:...`。当前固定的 `drone-ssh 1.8.1` 与生产服务器协商使用
ECDSA 主机密钥，已经用同版本客户端及本机可信 `known_hosts` 记录验证。
同一台服务器的 RSA、ECDSA、Ed25519 密钥有不同指纹，不能互换；本机 OpenSSH
登录成功也不表示它选择了与 CI 相同的密钥类型。升级 SSH 客户端或调整服务器密钥后，
需重新确认实际协商的类型，再通过可信控制台或已信任的 SSH 会话获取对应公钥指纹。
连接时必须通过指纹校验，不要通过留空 Secret 绕过检查。
密码只用于 SSH 认证，不传给构建命令，不写入仓库、前端环境文件或构建产物。
连接参数见 [SSH Action 官方说明](https://github.com/appleboy/ssh-action#-connection-settings)。

## 服务器前置条件

- 沿用已经部署好的 Ubuntu / 1Panel / OpenResty 站点及 SPA 和 `/api/` 配置。
  该工作流负责更新前端，不初始化服务器。
- SSH 端口能被 GitHub 托管 runner 访问，并允许部署用户通过密码登录。
- 应用根目录下 `src/frontend` 是当前仓库的干净 `main` 分支，部署用户可写。
  该用户已经能够无需交互拉取 GitHub 仓库及 TJARenderer 子模块。
  GitHub Actions 的登录密码不提供服务器到 GitHub 的访问权限；私有仓库需在服务器
  配置已有的只读 deploy key 等 Git 凭据。
- 有 Git、Bash、`flock`（Ubuntu 的 util-linux）及 GNU coreutils。
  Node.js 24 和项目指定的 pnpm 位于应用根目录下的 `toolchains/node/bin`、
  `toolchains/pnpm/bin`，或部署用户的非交互 `PATH`。
- 发布使用 `sudo -n` 操作站点目录。部署用户须已有这些操作的免密码 sudo 权限，
  或使用已有的 root 部署账号；SSH 密码不会用于回答 sudo 提示。

## 失败、连续推送和重试

- 检查失败或必填 Secret 缺失时，不连接服务器发布。
- 工作流串行运行，不会因新推送取消正在执行的发布；服务器额外使用文件锁，
  防止与手动发布同时修改源码和站点。
- 如果执行发布时 `main` 已有更新，旧提交会显示 `Skipping superseded frontend revision`
  并跳过发布，等待最新提交的工作流。手动重跑旧工作流也不会覆盖新版本。
- 服务器只允许 fast-forward 更新，并核对构建版本等于本次触发的 SHA。
  工作区有本地改动、分支不正确或历史分叉时会失败，需要先处理服务器源码状态。
- 安装、构建或复制失败时不会切换现有站点链接。失败的临时发布目录会清理，
  可以在 Actions 中重试。旧发布目录不会自动删除。

仍可直接在服务器手动更新最新 `main`：

```sh
bash /opt/ourtaiko-fanmade/src/frontend/deploy/publish.sh
```

使用自定义目录或远端时，手动执行也需设置对应的 `DEPLOY_BASE_PATH`、
`DEPLOY_SITE_PATH`、`DEPLOY_GIT_REMOTE` 环境变量。
