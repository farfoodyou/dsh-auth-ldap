# LDAP 接入清单

[English](ldap-integration.md) | 中文

目录侧需要提供什么、插件在协议上做什么、双方如何验证。这个文件可以直接转给管理目录的同事。

状态：目录后端已在插件中实现（M2），但在填完下面的表格之前保持关闭。本地账户已经可用；目录是**附加**
后端，所以目录登录失败不会把运维锁在门外。

## 1. 插件做什么

每次登录尝试的时序（`search-then-bind`，一条连接，`finally` 关闭）：

```
1. 连接           tcp/tls 到 ldap.url，connectTimeout = ldap.timeoutMs
2. （可选）升级    ldap:// + ldap.startTls 为 true 时做 STARTTLS
3. 服务账户绑定    simple bind：ldap.bindDn + 来自环境变量 ldap.bindPasswordEnv 的密码
                  ldap.bindDn 为空时跳过（匿名搜索）
4. 用户搜索       base = ldap.userSearchBase，scope = subtree，sizeLimit = 2，
                  filter = ldap.userSearchFilter，其中 {{username}} 按 RFC 4515 转义，
                  attributes = displayNameAttribute, cn, uid, displayName
                  0 条 → 拒绝；2 条 → 以「歧义」拒绝
5. 用户绑定       用上一步得到的 DN + 用户提交的密码做 simple bind
                  成功是密码正确的唯一证明；密码不会被保存
6. 服务账户重绑   仅当配置了服务账户且启用了群组搜索
7. 群组搜索       base = ldap.groupSearchBase，scope = subtree，
                  filter = ldap.groupSearchFilter，其中 {{dn}} 按 RFC 4515 转义，
                  attributes = groupNameAttribute, cn
8. unbind
```

需要目录侧确认的特性：

- 只用 **simple bind**。不涉及 SASL、Kerberos ticket、NTLM、代理认证。
- 插件从不写目录、不改密码、不读 `userPassword`。
- 登录名进入过滤器前一定按 RFC 4515 转义（`,`、`(`、`)`、`*`、`\`、NUL），找到的 DN 按 RFC 4514 转义。
- 登录限速在插件侧：同一账户或来源地址 5 次失败后冷却 5 分钟。若目录把失败 bind 计入账户锁定，
  锁定阈值必须高于 5，否则密码猜测负载会锁住真实用户。
- 所有失败都按类别记录日志（`invalid-credentials`、`ambiguous`、`unavailable`），登录响应本身是统一的。

## 2. 需要提供的值

填好这张表回传即可。空着的项对应的功能保持关闭。

| 键                          | 是否必需           | 示例                                                   | 说明                                                                    |
| --------------------------- | ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `ldap.url`                  | 必需               | `ldaps://dc1.corp.example.com:636`                     | `ldaps://`（推荐）或 `ldap://` + STARTTLS。只有主机和可选端口，不带路径 |
| TLS 信任                    | 必需               | `rejectUnauthorized: true`                             | 私有 CA 需提供证书，以便装到主机信任链                                  |
| `ldap.startTls`             | `ldap://` 时必需   | `true`                                                 | 明文 `ldap://` 必须开启，插件会拒绝无 TLS 的明文                        |
| `ldap.timeoutMs`            | 可选               | `10000`                                                | 连接与操作超时                                                          |
| `ldap.userSearchBase`       | 必需               | `ou=people,dc=corp,dc=example,dc=com`                  | 搜索登录账户的子树                                                      |
| `ldap.userSearchFilter`     | 必需               | `(sAMAccountName={{username}})` / `(uid={{username}})` | 必须包含 `{{username}}`                                                 |
| `ldap.displayNameAttribute` | 可选               | `displayName`                                          | 回退顺序 `cn` → `uid` → 登录名                                          |
| `ldap.bindDn`               | 建议               | `cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com`      | 只读搜索账户；留空表示匿名搜索                                          |
| 服务账户密码                | 有 `bindDn` 时必需 | 环境变量 `DSH_LDAP_BIND_PASSWORD`                      | 通过服务的环境变量下发，不写进配置                                      |
| `ldap.groupSearchBase`      | 需要角色时         | `ou=groups,dc=corp,dc=example,dc=com`                  | 留空则不做群组映射（所有人都是 `viewer`）                               |
| `ldap.groupSearchFilter`    | 需要角色时         | `(member={{dn}})` 或 `(uniqueMember={{dn}})`           | 必须包含 `{{dn}}`                                                       |
| `ldap.groupNameAttribute`   | 可选               | `cn`                                                   | 与 `ldap.adminGroups` 比较                                              |
| `ldap.adminGroups`          | 需要管理员时       | `[dsh-admins]`                                         | 常见名或完整 DN，大小写不敏感                                           |
| 来源网段                    | 必需               | `192.168.8.100`                                        | 运行 `dsh` 的主机，需要放通目录端口                                     |

### 服务账户权限

- 用户子树只读：`sAMAccountName`/`uid`、`displayName`、`cn`、`uid`。
- 群组子树只读：`cn`（或配置的群组名属性）与成员关系。
- 不需要写权限、不需要重置密码、不能建账户。
- 密码不要设很短的过期周期；轮换时更新环境变量并重启 `dsh` profile（插件在登录时读取该变量，
  重启只是为了服务单元拿到新值）。

## 3. Active Directory 要点

| 关注点     | 建议                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 登录属性   | `sAMAccountName`（短名）或 `userPrincipalName`（邮件式），二选一：`(sAMAccountName={{username}})` 或 `(userPrincipalName={{username}})` |
| 传输       | 走 636 的 LDAPS。AD 的 389 + STARTTLS 可用，但企业策略里少见                                                                            |
| 群组       | 在群组 base 上用 `(member={{dn}})` 可行；用户条目上的 `memberOf` 更省，但本插件不把它当过滤器属性                                       |
| 管理员判定 | 建议单独建 `dsh-admins` 之类的组，而不是 Domain Admins                                                                                  |
| 锁定策略   | AD 的锁定阈值作用于失败 bind，必须高于 5，或在灰度前调高插件配额                                                                        |
| 嵌套组     | **不解析**。用户必须是管理员组的直接成员，或把该组显式列进配置                                                                          |
| 禁用账户   | 用户 bind 会失败，插件归类为 `invalid-credentials`                                                                                      |

## 4. OpenLDAP / LLDAP 要点

| 关注点     | 建议                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录属性   | `uid`，或想要邮件式登录时用 `mail`                                                                                                                                   |
| 传输       | 636 的 `ldaps://`，或 389 的 `ldap://` + `startTls: true`                                                                                                            |
| 群组       | `groupOfNames` 用 `(member={{dn}})`，`groupOfUniqueNames` 用 `(uniqueMember={{dn}})`；`memberUid` 需要 `(memberUid={{username}})`，**当前不支持**（只支持 `{{dn}}`） |
| 管理员判定 | 建议单独的 `dsh-admins` 组                                                                                                                                           |
| LLDAP      | `uid` + `member` 可用；注意 LLDAP 的 LDAP 端口不是它的 Web 端口                                                                                                      |

## 5. 回传的配置

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: dsh-auth-ldap
  config:
    mode: gate
    local:
      enabled: true
      usersFile: /home/dsh/.dsh/storages/auth-ldap/users.json
    ldap:
      enabled: true
      url: ldaps://待填:636
      userSearchBase: 待填
      userSearchFilter: (sAMAccountName={{username}}) # 或 (uid={{username}})
      displayNameAttribute: displayName
      bindDn: 待填
      bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
      groupSearchBase: 待填
      groupSearchFilter: (member={{dn}})
      groupNameAttribute: cn
      adminGroups: [待填]
      startTls: false
      rejectUnauthorized: true
      timeoutMs: 10000
```

再在服务单元里加：

```ini
Environment=DSH_LDAP_BIND_PASSWORD=...
```

## 6. 验证步骤

在运行 `dsh` 的主机上，先不碰插件：

```sh
# 1. 传输与证书
openssl s_client -connect dc1.corp.example.com:636 -servername dc1.corp.example.com </dev/null \
  | openssl x509 -noout -subject -issuer -dates

# 2. 服务账户绑定 + 用户搜索
ldapsearch -H ldaps://dc1.corp.example.com:636 \
  -D 'cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com' -W \
  -b 'ou=people,dc=corp,dc=example,dc=com' '(sAMAccountName=alice)' dn displayName

# 3. 用真实密码做用户绑定
ldapsearch -H ldaps://dc1.corp.example.com:636 \
  -D '<上面打印的 DN>' -W -b 'ou=groups,dc=corp,dc=example,dc=com' '(member=<上面打印的 DN>)' cn
```

插件挂载后：

```sh
# 部署形态（不含秘密）：确认目录后端已启用
curl -s http://127.0.0.1:3080/auth-ldap/status

# 端到端：成功应为 303，错误密码应为 401
curl -si -H 'Origin: https://dsh.example' -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=alice&password=错误密码' https://dsh.example/auth/login | head -1
```

日志会给出每次尝试的失败类别：

```
dsh-auth-ldap: directory backend rejected alice: unavailable (TimeoutError: operation timed out)
dsh-auth-ldap: directory backend rejected alice: ambiguous (2 entries matched)
dsh-auth-ldap: login succeeded: alice (ldap) from 192.168.8.10
```

## 7. 需要提前告知对方的限制

- 不支持 SASL、Kerberos、NTLM：只有 simple bind。
- 不支持 `memberUid` 形式的群组：成员关系必须是 DN 值（`member` 或 `uniqueMember`）。
- 不解析嵌套组。
- 没有「按组白名单」：通过搜索的账户都能登录。要限制人群请用搜索 base 或过滤器。
- 所有已认证会话在 `dsh` 内部都是共享的 operator 身份：目录身份用于认证和角色选择，不用于数据隔离
  （那是二期）。
- 每次登录一对 bind，没有连接池：负载是平稳的小流量，不是突发。
