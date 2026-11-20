# LDAP integration sheet

[English](ldap-integration.md) | [中文](ldap-integration.zh.md)

What the directory team has to provide, what this plugin does on the wire, and how both sides verify
that it works. Hand this file to whoever operates the directory.

Status: the directory backend is implemented in the plugin (M2) but disabled until the values below are
filled in. Local accounts already work; the directory is additive, so a failed directory login never
locks the operator out.

## 1. What the plugin does

Sequence per login attempt (`search-then-bind`, one connection, closed in `finally`):

```
1. connect            tcp/tls to ldap.url, connectTimeout = ldap.timeoutMs
2. (optional) STARTTLS upgrade when ldap.startTls is true on ldap://
3. service bind       simple bind with ldap.bindDn + password from env(ldap.bindPasswordEnv)
                      skipped when ldap.bindDn is empty (anonymous search)
4. user search        base = ldap.userSearchBase, scope = subtree, sizeLimit = 2,
                      filter = ldap.userSearchFilter with {{username}} escaped per RFC 4515,
                      attributes = displayNameAttribute, cn, uid, displayName
                      0 matches -> rejected; 2 matches -> rejected as ambiguous
5. user bind          simple bind as the found entry DN with the submitted password
                      success is the only proof of the password; the password is never stored
6. service re-bind    only when a service account is configured and group search is enabled
7. group search       base = ldap.groupSearchBase, scope = subtree,
                      filter = ldap.groupSearchFilter with {{dn}} escaped per RFC 4515,
                      attributes = groupNameAttribute, cn
8. unbind
```

Properties worth confirming with the directory team:

- Only **simple bind** is used. No SASL, no Kerberos ticket, no NTLM, no proxied auth.
- The plugin never writes to the directory, never changes passwords, and never reads `userPassword`.
- The submitted login name reaches a filter only through RFC 4515 escaping (`,`, `(`, `)`, `*`, `\`,
  NUL), and the found DN only through RFC 4514 escaping. Live filter values are always escaped; filters
  are configuration.
- Failed logins are throttled by the plugin: five failures per account or per client address trigger a
  five-minute cooldown. A directory that counts failed binds toward account lockout will lock accounts
  under password-guessing load, so the lockout threshold should be higher than five.
- Every failure mode is logged with a reason class (`invalid-credentials`, `ambiguous`, `unavailable`)
  and the login response itself is uniform.

## 2. Values we need

Fill this table in and send it back. Anything left blank keeps the corresponding feature off.

| Key                         | Needed         | Example                                                | Notes                                                                                  |
| --------------------------- | -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `ldap.url`                  | yes            | `ldaps://dc1.corp.example.com:636`                     | `ldaps://` (preferred) or `ldap://` + STARTTLS. Host and optional port only, no path   |
| TLS trust                   | yes            | `rejectUnauthorized: true`                             | If the chain is private, provide the CA certificate so it can be installed on the host |
| `ldap.startTls`             | when `ldap://` | `true`                                                 | Required for plain `ldap://`; the plugin refuses cleartext without it                  |
| `ldap.timeoutMs`            | no             | `10000`                                                | Connect + operation timeout                                                            |
| `ldap.userSearchBase`       | yes            | `ou=people,dc=corp,dc=example,dc=com`                  | Subtree searched for the login account                                                 |
| `ldap.userSearchFilter`     | yes            | `(sAMAccountName={{username}})` / `(uid={{username}})` | Must contain `{{username}}`                                                            |
| `ldap.displayNameAttribute` | no             | `displayName`                                          | Falls back to `cn`, `uid`, then the login name                                         |
| `ldap.bindDn`               | recommended    | `cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com`      | Read-only search account; empty means anonymous search                                 |
| service password            | with `bindDn`  | env `DSH_LDAP_BIND_PASSWORD`                           | Delivered as an environment variable for the service, never in configuration           |
| `ldap.groupSearchBase`      | for roles      | `ou=groups,dc=corp,dc=example,dc=com`                  | Empty disables group mapping (everyone gets `viewer`)                                  |
| `ldap.groupSearchFilter`    | for roles      | `(member={{dn}})` or `(uniqueMember={{dn}})`           | Must contain `{{dn}}`                                                                  |
| `ldap.groupNameAttribute`   | no             | `cn`                                                   | Compared against `ldap.adminGroups`                                                    |
| `ldap.adminGroups`          | for admin      | `[dsh-admins]`                                         | Common names or full DNs; matched case-insensitively                                   |
| Source network              | yes            | `192.168.8.100`                                        | The host running `dsh`; open the directory port to it                                  |

### Service account rights

- Read access to the user subtree: `sAMAccountName`/`uid`, `displayName`, `cn`, `uid`.
- Read access to the group subtree: `cn` (or the configured group name attribute) and membership.
- No write, no password reset, no account creation.
- Its password must not expire on a short cycle; when it rotates, update the environment variable and
  restart the `dsh` profile (the plugin reads it at login time, so a restart is only needed for the
  service unit to see the new value).

## 3. Active Directory specifics

| Concern           | Guidance                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login attribute   | `sAMAccountName` (short name) or `userPrincipalName` (email-style). Pick one: `(sAMAccountName={{username}})` or `(userPrincipalName={{username}})` |
| Transport         | LDAPS on 636. AD's STARTTLS on 389 works but is unusual in enterprise policy                                                                        |
| Groups            | `(member={{dn}})` against the group base works; `memberOf` on the user entry is cheaper but not exposed as a filter attribute here                  |
| Admin detection   | Prefer a dedicated group such as `dsh-admins` rather than Domain Admins                                                                             |
| Lockout           | AD lockout thresholds apply to failed binds; keep the threshold above five, or raise the plugin budget before rollout                               |
| Nested groups     | Not resolved. A user must be a direct member of the admin group, or the group must be listed explicitly                                             |
| Disabled accounts | The user bind fails for a disabled account, which the plugin reports as `invalid-credentials`                                                       |

## 4. OpenLDAP / LLDAP specifics

| Concern         | Guidance                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login attribute | `uid`, or `mail` if email-style logins are wanted                                                                                                                                                             |
| Transport       | `ldaps://` on 636, or `ldap://` + `startTls: true` on 389                                                                                                                                                     |
| Groups          | `(member={{dn}})` with `groupOfNames`, or `(uniqueMember={{dn}})` with `groupOfUniqueNames`; `memberUid` requires `(memberUid={{username}})` instead, which the plugin does not support today (only `{{dn}}`) |
| Admin detection | A dedicated group such as `dsh-admins`                                                                                                                                                                        |
| LLDAP           | Works with `uid` and `member`; remember LLDAP's LDAP port is not its web port                                                                                                                                 |

## 5. Configuration to hand back

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
      url: ldaps://FILL-IN:636
      userSearchBase: FILL-IN
      userSearchFilter: (sAMAccountName={{username}}) # or (uid={{username}})
      displayNameAttribute: displayName
      bindDn: FILL-IN
      bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
      groupSearchBase: FILL-IN
      groupSearchFilter: (member={{dn}})
      groupNameAttribute: cn
      adminGroups: [FILL-IN]
      startTls: false
      rejectUnauthorized: true
      timeoutMs: 10000
```

Then, in the service unit:

```ini
Environment=DSH_LDAP_BIND_PASSWORD=...
```

## 6. Verification

From the host that runs `dsh`, before touching the plugin:

```sh
# 1. transport and certificate
openssl s_client -connect dc1.corp.example.com:636 -servername dc1.corp.example.com </dev/null \
  | openssl x509 -noout -subject -issuer -dates

# 2. service bind + user search
ldapsearch -H ldaps://dc1.corp.example.com:636 \
  -D 'cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com' -W \
  -b 'ou=people,dc=corp,dc=example,dc=com' '(sAMAccountName=alice)' dn displayName

# 3. user bind with the real password
ldapsearch -H ldaps://dc1.corp.example.com:636 \
  -D '<the DN printed above>' -W -b 'ou=groups,dc=corp,dc=example,dc=com' '(member=<the DN printed above>)' cn
```

Then, with the plugin mounted:

```sh
# deployment shape (no secrets): confirms the backend is enabled
curl -s http://127.0.0.1:3080/auth-ldap/status

# end to end: expect 303 on success, 401 on a wrong password
curl -si -H 'Origin: https://dsh.example' -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=alice&password=WRONG' https://dsh.example/auth/login | head -1
```

Logs report the failure class for each attempt:

```
dsh-auth-ldap: directory backend rejected alice: unavailable (TimeoutError: operation timed out)
dsh-auth-ldap: directory backend rejected alice: ambiguous (2 entries matched)
dsh-auth-ldap: login succeeded: alice (ldap) from 192.168.8.10
```

## 7. Known limitations to disclose

- No SASL, Kerberos, or NTLM: simple bind only.
- No `memberUid` group style; group membership must be DN-valued (`member` or `uniqueMember`).
- Nested groups are not resolved.
- No group-based allow-list: any account that passes the search may sign in. Restrict the login
  population with the user search base or filter instead.
- Every authenticated session acts as the shared operator peer inside `dsh`; directory identity is used
  for authentication and role selection, not for data isolation (that is phase 2).
- One bind pair per login attempt, no connection pool: expect a small, steady bind load rather than
  bursts.
