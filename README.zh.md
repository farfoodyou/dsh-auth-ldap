# dsh-auth-ldap

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 Web profile 提供认证门禁：
用一个登录页、一份配置，支持**本地账户**和 **LDAP / Active Directory** 两种凭据。

> **状态：开发者预览。** 见 [docs/ldap-integration.zh.md](docs/ldap-integration.zh.md)。M1 已交付：真正可用的门禁 + 本地账户 + 签名会话 + 登录限速 + 登出。目录后端在 M2（0.3.0），
> `ldap.*` 配置会被校验但尚未生效。见 [docs/roadmap.md](docs/roadmap.md)。

## 为什么需要它

`dsh` 本身没有登录。它有的是：

| 层                             | `dsh` 提供的                                       |
| ------------------------------ | -------------------------------------------------- |
| `account` 子系统               | DeepSeek 平台 OAuth 登录，用于计费和额度           |
| Web 准入                       | 启动 token 换签名 cookie，按 host authority 做栅栏 |
| 多用户、群组、LDAP、SAML、RBAC | **没有**                                           |

所以共享部署只有两个选择：把启动链接发给别人（拿到链接就是 owner），或者在前面加一道登录门禁。
社区已有门禁插件，但它们都用自己的密码文件校验，**没有一个能对接目录服务**。`dsh-auth-ldap` 补上这个缺口，
并且**不 fork `@deepseek-ai/dsh-host-webserver`**，因此 dsh 升级时不需要跟着 rebase。

## 将要做什么

**一期 —— 认证门禁**

- 一个登录页 + 两种凭据后端：本地账户（JSON 文件里的 `scrypt` 记录）、目录账户（LDAPS 或 STARTTLS 上的
  `search-then-bind`，支持群组到角色映射）。
- 签名的 `HttpOnly` + `SameSite=Lax` 会话 cookie，配服务端会话表：可吊销、受 TTL 约束、持久化，重启不掉线。
- 页面文档与 `/api` 传输双层把关；`/api` 自带的 host 栅栏保持不变。
- 登录限速：同一客户端地址 5 次失败后冷却 5 分钟；同一账户 20 次失败后进一步放慢。**正确的密码不会因为
  账户计数用尽而被拒绝**，所以没人能把运维锁在门外；失败响应不泄露账户是否存在。
- 每次决策都会写进 `<storage.dir>/audit.log`（账户、地址、后端、失败类别）—— 因为 harness 的 logger 在没有
  注册 exporter 时会静默丢弃插件告警。
- `observe` 模式：只记录决策不拒绝，便于灰度上线。
- 进程启动 token 保留为**应急通道**，账户文件丢失也不会把 owner 锁在门外。
- 未认证的 `/auth-ldap/status` 文档，供冒烟测试与监控使用。

**二期 —— 按用户隔离（独立里程碑）**

`dsh` 是单租户运行时：会话、工作区、凭据都在同一个 `$DSH_HOME` 下。因此认证十个人，进去的仍是同一个环境。
二期按 principal 划分这些资源。它被**刻意排除在本仓库一期之外**，理由见
[docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md#phase-2-per-user-isolation)。

## 环境要求

- Node.js `>= 22.19.0`（dsh 启动器自带运行时，这里是插件自身的下限）。
- `dsh >= 0.2.2-rc.1`。dsh 仍处于 pre-stable 阶段，依赖前请锁定已验证的版本范围。
- 一个 LDAP v3 目录（OpenLDAP、LLDAP、389 DS、Active Directory），通过 LDAPS 或 STARTTLS 可达。

开发插件还需要 **pnpm 12**，版本通过 `package.json` 的 `packageManager` 锁定。执行一次 `corepack enable`，
`pnpm` 会自动解析到锁定版本；也可以直接 `npm i -g pnpm@12`。

## 安装

```sh
pnpm dlx @deepseek-ai/dsh plugin --profile web add dsh-auth-ldap   # 从 npm（发布之后）
pnpm dlx @deepseek-ai/dsh plugin --profile web add github:<owner>/dsh-auth-ldap   # 从 git 仓库
```

包内声明了 `dsh.bundle.patch`，所以 `dsh plugin add` 会自动把插件行插入 profile。如果 `dsh` 已在 `PATH` 中，
去掉 `pnpm dlx @deepseek-ai/dsh` 前缀，直接用 `dsh plugin ...`。

部署参数放在 profile 的用户层：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: dsh-auth-ldap
  config:
    mode: gate
    local:
      enabled: true
      usersFile: /var/lib/dsh/users.yaml
    ldap:
      enabled: true
      url: ldaps://dc1.corp.example.com:636
      userSearchBase: ou=people,dc=corp,dc=example,dc=com
      userSearchFilter: (sAMAccountName={{username}})
      bindDn: uid=svc-dsh,ou=service,dc=corp,dc=example,dc=com
      bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
      groupSearchBase: ou=groups,dc=corp,dc=example,dc=com
      groupSearchFilter: (member={{dn}})
      adminGroups: [dsh-admins]
```

改完用户层后重启 profile，然后检查部署：

```sh
curl -s http://127.0.0.1:3080/auth-ldap/status
```

## 使用

启动已安装插件的 profile：

```sh
dsh web                      # 等价于 dsh --profile web
```

然后在浏览器里：

| 步骤             | 会发生什么                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| 打开打印出的 URL | dsh 打印 `http://127.0.0.1:3080/?token=...`；启动 token 仍然是 owner 凭据 |
| 遇到登录页       | 从 M1 起，未认证请求会被重定向到 `loginPath`                              |
| 登录             | 本地账户，或目录账户（search-then-bind）                                  |
| 使用界面         | 已准入的会话与启动 token cookie 并存，任一有效即可访问，直到过期          |

运维命令：

```sh
curl -s http://127.0.0.1:3080/auth-ldap/status          # 部署形态，不含秘密
dsh plugin --profile web remove dsh-auth-ldap           # 卸载
```

M1 落地之前，插件只提供状态路由；界面仍然只靠启动 token 准入。

## 配置项

| 键                                                | 默认值                         | 含义                                                        |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `mode`                                            | `gate`                         | `gate` 拒绝未认证请求；`observe` 只记录                     |
| `publicHost`                                      | `""`                           | 登录页展示的 host，留空回退请求头 `Host`                    |
| `loginPath` / `logoutPath`                        | `/auth/login` / `/auth/logout` | 门禁路径                                                    |
| `statusPath`                                      | `/auth-ldap/status`            | 未认证的状态文档                                            |
| `trustedProxyCidrs`                               | `[]`                           | 可信反向代理网段，只有这些来源的转发 IP 头才被读取          |
| `clientIpHeader`                                  | `x-forwarded-for`              | 仅当对端是可信代理时，从这个头读取客户端地址                |
| `local.enabled`                                   | `false`                        | 启用本地账户文件                                            |
| `local.usersFile`                                 | `""`                           | 账户文件绝对路径                                            |
| `ldap.enabled`                                    | `false`                        | 启用目录登录                                                |
| `ldap.url`                                        | `""`                           | `ldaps://host[:port]` 或 `ldap://host[:port]`               |
| `ldap.userSearchBase`                             | `""`                           | 搜索登录账户的 Base DN                                      |
| `ldap.userSearchFilter`                           | `(uid={{username}})`           | 用户过滤器，`{{username}}` 会按 RFC 4515 转义               |
| `ldap.bindDn` / `ldap.bindPasswordEnv`            | `""`                           | 搜索用服务账户；留空表示匿名搜索                            |
| `ldap.displayNameAttribute`                       | `displayName`                  | 显示名属性                                                  |
| `ldap.groupSearchBase` / `ldap.groupSearchFilter` | `""` / `(member={{dn}})`       | 群组映射查询                                                |
| `ldap.adminGroups`                                | `[]`                           | 成员获得 `admin` 角色的群组                                 |
| `ldap.startTls`                                   | `false`                        | 对 `ldap://` 连接启用 STARTTLS                              |
| `ldap.rejectUnauthorized`                         | `true`                         | 校验目录证书                                                |
| `ldap.caFile`                                     | `""`                           | 目录证书用的 PEM CA 包；留空用系统根证书                    |
| `ldap.timeoutMs`                                  | `10000`                        | 连接与搜索超时                                              |
| `session.cookieName`                              | `dsh_auth_ldap`                | 会话 cookie 名                                              |
| `session.ttlSeconds`                              | `43200`                        | 会话绝对有效期                                              |
| `session.secure`                                  | `true`                         | 是否输出 `Secure` 属性                                      |
| `storage.dir`                                     | `""`                           | 签名密钥与会话表目录；留空用 `$DSH_HOME/storages/auth-ldap` |

配置校验分两层：schema 在加载时拒绝形状与范围错误；`validateConfig` 拒绝组合错误，例如
「启用 LDAP 但没有搜索 Base DN」「明文 LDAP 且未开 STARTTLS」。这类错误会中止挂载。而部署异味
（没有配置任何后端、只有本地账户、关闭了证书校验）只记警告，插件照常挂载，便于在运行中的实例上排查。

## 接入目录

先读 [docs/ldap-integration.zh.md](docs/ldap-integration.zh.md)：里面列了目录侧必须提供的值、插件在协议上执行的
确切时序，以及它绝不做什么（不写目录、不读密码、只做 simple bind）。拿到回填的表后填进 profile 用户层，把服务账户
密码放进服务单元的环境变量，重启即可。

```yaml
ldap:
  enabled: true
  url: ldaps://dc1.corp.example.com:636
  userSearchBase: ou=people,dc=corp,dc=example,dc=com
  userSearchFilter: (sAMAccountName={{username}})
  bindDn: cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com
  bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
  groupSearchBase: ou=groups,dc=corp,dc=example,dc=com
  groupSearchFilter: (member={{dn}})
  adminGroups: [dsh-admins]
```

## 安全模型

完整威胁模型见 [docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md)，要点：

- 密码只用于校验，随后丢弃；本地账户只保存 scrypt 哈希。
- 会话 cookie 签名（`HMAC-SHA256`），`HttpOnly`、`SameSite=Lax`，默认 `Secure`。
- 会话在服务端可吊销；删除会话或禁用账户即刻失效。
- 登录名进入目录过滤器前按 RFC 4515 转义。
- 失败登录按账户与来源地址限速，响应不泄露账户是否存在。
- 只有直连来源位于 `trustedProxyCidrs` 时，才读取转发 IP 头。

漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。

## 开发

```sh
corepack enable      # 执行一次；之后 pnpm 跟随 package.json 的 packageManager
pnpm install
pnpm verify          # typecheck + lint + format check + tests + build
pnpm test            # vitest
pnpm run test:watch  # vitest 监视模式
pnpm run build       # tsc -> lib/
pnpm run format      # prettier --write .
```

`pnpm verify` 就是 CI 在 Node 22 / 24 上执行的内容，每次提交前跑一遍。`pnpm-lock.yaml` 会入库，
CI 用 `--frozen-lockfile` 安装。

目录：

```
src/config.ts        schema、默认值、跨字段校验、部署警告
src/gate.ts          准入：包装 connection.admit / connection.authorizeIndex
src/session.ts       签名 cookie、会话表、签名密钥加载
src/users.ts         账户文件模型与本地凭据校验
src/password.ts      scrypt 哈希与常数时间校验
src/login-page.ts    登录页文档
src/routes/          登录、登出、状态 handler
src/cli.ts           `dsh-auth-ldap` 账户维护
src/principal.ts     本插件的 PrincipalMap 条目
test/                单元测试，与 src/ 对应
docs/design/         设计说明
docs/adr/            架构决策记录
```

分支、提交与发布流程见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)；面向 AI 代理的约定见 [AGENTS.md](AGENTS.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
