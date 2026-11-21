# 部署指南

[English](deployment.md) | 中文

怎么把插件跑在真机上：一个 `systemd` 单元、一个 profile、一个反向代理。参考部署是局域网实例，
以 `dsh.example.com` 通过终止 TLS 的代理访问；把占位符换成你自己的环境。

下面所有值都是占位符。**绝不要提交真实主机名、目录 DN 或密码。**

## 1. 谁在哪里

```
浏览器 ──HTTPS──▶ 反向代理 (:443, TLS) ──HTTP──▶ dsh web (:3080, 回环或局域网地址)
                        │                              │
                        └─ 保留 Host，追加 X-Forwarded-For
                                                       └─ dsh-auth-ldap 把守页面与 /api
```

- `dsh` 自身只提供明文 HTTP。代理终止 TLS 时，`session.secure` 保持默认即可，由插件按请求判断
  （明文 HTTP 源下浏览器会丢掉 `Secure` cookie，所以能用 `http://host:3080` 登录是因为该属性跟随请求 scheme）。
- 监听地址要填代理真正能到的那个，**不要用 `0.0.0.0`**（dsh 本身会拒绝通配地址）。

## 2. 安装或升级 `dsh`

`dsh` 没有自带更新命令。它住在固定的 Node 目录里，升级就是往那个目录做一次全局安装：

```sh
export PATH="$HOME/.local/share/node24/current/bin:$PATH"
DEST="$HOME/.local/share/node24/current"

# 看当前版本和可用版本
dsh --version
npm view @deepseek-ai/dsh dist-tags --json

# 升级（或首次安装）—— 注意下面的安装脚本陷阱
npm i -g @deepseek-ai/dsh@<版本> --prefix "$DEST" --no-audit --no-fund \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs

dsh --version
systemctl --user restart dsh-web
```

如果这台机器出网需要代理，只给这次安装加环境变量：

```sh
export http_proxy=http://proxy.example.com:7890 https_proxy=$http_proxy
```

### `--allow-scripts` 陷阱

npm 12 默认**阻止生命周期脚本**，除非显式放行。跳过脚本的 `dsh` 安装看起来成功，运行时才炸：

| 包                                  | 脚本                          | 被阻止后的症状                 |
| ----------------------------------- | ----------------------------- | ------------------------------ |
| `@deepseek-ai/dsh-subprocess-local` | `postinstall`（spawn helper） | agent 的 bash / 子进程工具失败 |
| `node-pty`                          | `install`                     | 终端面板失败                   |
| `koffi`                             | `install`                     | 依赖 FFI 的功能失败            |
| `@google/genai`、`protobufjs`       | `preinstall` / `postinstall`  | 模型提供方或 protobuf 调用失败 |

`npm` 会打印一条警告列出这些包，把列表原样传给 `--allow-scripts` 即可。装完要验证：

```sh
DEST="$HOME/.local/share/node24/current/lib/node_modules/@deepseek-ai/dsh"
ls "$DEST/node_modules/node-pty/prebuilds/"          # 应能看到 linux-x64 等目录
dsh --profile headless "run: echo ok"                # 端到端验证子进程
```

### 回滚

```sh
npm i -g @deepseek-ai/dsh@<上一个版本> --prefix "$DEST" --no-audit --no-fund \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs
systemctl --user restart dsh-web
```

升级前记下 `package.json` 里的版本号就够了 —— profile、会话、凭据都不在安装目录里。

## 3. 服务单元

`~/.config/systemd/user/dsh-web.service`：

```ini
[Unit]
Description=DeepSeek Harness (dsh) web UI — https://dsh.example.com/
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h
EnvironmentFile=%h/.dsh/ldap.env
ExecStart=%h/.local/bin/dsh --profile web --host 192.0.2.10 --port 3080 --no-open \
  --public-url https://dsh.example.com/ --trusted-host dsh.example.com
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.dsh/logs/dsh-web.log
StandardError=append:%h/.dsh/logs/dsh-web.log

[Install]
WantedBy=default.target
```

```sh
mkdir -p ~/.dsh/logs
systemctl --user daemon-reload
systemctl --user enable --now dsh-web
loginctl enable-linger "$USER"      # 开机自启，不需要有人登录
systemctl --user status dsh-web
```

`Linger=yes` 是重启后服务自动拉起的**关键**：没有它，`systemd --user` 单元只在有人登录时才启动。

`EnvironmentFile` 存放目录服务账户密码（`DSH_LDAP_BIND_PASSWORD=...`，权限 `0600`）。如果不想用
`ldap.caFile`，可以加 `Environment=NODE_EXTRA_CA_CERTS=/path/to/ca.crt` 让进程信任私有 CA。

## 4. 把插件装进 profile

```sh
dsh plugin --profile web add dsh-auth-ldap        # 发布后从 npm
dsh plugin --profile web add /path/to/checkout    # 从本地 checkouts
```

配置写在 profile 的用户层，它在所有 bundle 层之后应用：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-auth-ldap
  config:
    mode: gate
    # 这台实例前面的代理；不配的话所有客户端共用一个限速桶，
    # 一个人猜错五次就把所有人锁在门外
    trustedProxyCidrs: ['192.0.2.200/32']
    clientIpHeader: x-forwarded-for
    local:
      enabled: true
      usersFile: /home/dsh/.dsh/storages/auth-ldap/users.json
    ldap:
      enabled: true
      url: ldaps://192.0.2.20:636
      userSearchBase: ou=people,dc=corp,dc=example,dc=com
      userSearchFilter: (uid={{username}})
      bindDn: cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com
      bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
      caFile: /etc/pki/ca-trust/source/anchors/corp-ca.crt
      groupSearchBase: ou=groups,dc=corp,dc=example,dc=com
      groupSearchFilter: (member={{dn}})
      groupNameAttribute: cn
      adminGroups: [dsh-admins]
      startTls: false
      rejectUnauthorized: true
```

在依赖门禁之前，先创建本地应急账户：

```sh
printf '%s' '改成你的密码' | dsh-auth-ldap add operator --role admin
dsh-auth-ldap list
```

## 5. 磁盘上的状态

| 路径                                      | 内容                       | 需要备份     |
| ----------------------------------------- | -------------------------- | ------------ |
| `~/.dsh/storages/auth-ldap/users.json`    | 本地账户，只有 scrypt 记录 | 是           |
| `~/.dsh/storages/auth-ldap/session.key`   | 会话签名密钥               | 是           |
| `~/.dsh/storages/auth-ldap/sessions.json` | 活跃会话                   | 否（可重建） |
| `~/.dsh/storages/auth-ldap/audit.log`     | 登录审计                   | 可选         |
| `~/.dsh/ldap.env`                         | 服务账户密码               | 是（机密）   |
| `~/.dsh/profiles/web/cordis.patch.yml`    | 插件配置                   | 是           |
| `~/.config/systemd/user/dsh-web.service`  | 服务单元                   | 是           |
| `~/.dsh/.credentials.yaml`                | dsh 浏览器会话签名密钥     | 是           |

```sh
tar czf ~/backups/dsh-config-$(date +%F).tgz \
  .dsh/storages/auth-ldap .dsh/profiles/web/cordis.patch.yml .dsh/ldap.env \
  .dsh/.credentials.yaml .config/systemd/user/dsh-web.service
```

丢了 `users.json` 或 `session.key` 也不会被锁在门外：启动时打印的进程 token 仍是应急通道。

## 6. 升级检查清单

每次升级 `dsh` 后都要跑 —— 插件包装的是服务方法，跨 release candidate 不保证行为不变：

```sh
H=https://dsh.example.com

curl -s "$H/auth-ldap/status"                                   # 1 插件挂载、后端启用
curl -s -o /dev/null -w '%{http_code}\n' "$H/"                  # 2 303 跳登录页
curl -si -H 'Origin: '$H -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=operator&password=改成你的密码' "$H/auth/login" | head -1   # 3 303
curl -si -H 'Origin: '$H -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=<目录用户>&password=错误' "$H/auth/login" | head -1          # 4 401
curl -s -o /dev/null -w '%{http_code}\n' "$H/api/<任意>"          # 5 无会话应 401
dsh --profile headless "run: echo ok"                            # 6 子进程仍可用
```

然后用浏览器确认登录后能正常加载应用文档，并检查 `~/.dsh/logs/dsh-web.log` 里有 `gate mounted`。

任何一项失败：回滚 `dsh` 版本（第 2 节）并重启，插件状态不会变。

## 7. 排障

| 症状                                            | 原因                                                 | 处理                                                                        |
| ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| 登录成功又被弹回登录页                          | 页面走明文 HTTP，`Secure` cookie 被浏览器丢弃        | 改用 HTTPS 访问，或让 `session.secure` 跟随请求 scheme（默认行为）          |
| 所有人都被提示 `Too many attempts`              | 没配 `trustedProxyCidrs`，所有客户端共用代理的限速桶 | 配置 `trustedProxyCidrs` 与 `clientIpHeader`                                |
| `dsh: warning: 1 entry did not activate`        | 配置被拒绝，插件没挂载                               | 去 `~/.dsh/logs/dsh-web.log` 看原因，改用户层                               |
| `journalctl` 里什么都没有                       | harness logger 需要注册 exporter                     | 看 `~/.dsh/logs/dsh-web.log`（单元重定向）和 `storages/auth-ldap/audit.log` |
| 目录登录报 `unavailable`                        | TLS、服务绑定或网络不可达                            | 按 [ldap-integration.zh.md](ldap-integration.zh.md#6-验证步骤) 逐条验证     |
| 密码正确却报 `invalid-credentials`              | 登录属性写错，或用户不在 `userSearchBase` 下         | 用 `ldapsearch` 确认过滤器与 base                                           |
| `openssl -starttls` 能通，但插件报 `ECONNRESET` | 有些服务端只支持 `ldaps://`                          | 把 `ldap.url` 改成 `ldaps://host:636`，`startTls: false`                    |
| 升级后 agent 工具全挂                           | 生命周期脚本被阻止                                   | 用 `--allow-scripts` 重装（第 2 节）                                        |
