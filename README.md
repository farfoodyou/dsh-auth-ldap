# dsh-auth-ldap

[English](README.md) | [中文](README.zh.md)

Authentication gate for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web
profiles: sign in with a **local account** or an **LDAP / Active Directory** account, through one login
page and one configuration.

> **Status: developer preview.** Milestone M0 (repository scaffolding, configuration schema, plugin
> entry) is complete. The gate itself lands in M1 and the directory backend in M2; see
> [docs/roadmap.md](docs/roadmap.md). Do not put this in front of a production instance yet.

## Why this exists

`dsh` ships no login of its own. What it has is:

| Layer                                | What `dsh` provides                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `account` subsystem                  | DeepSeek platform OAuth login, for billing and quotas                            |
| web admission                        | one process launch token exchanged for a signed cookie, fenced by host authority |
| multi-user, groups, LDAP, SAML, RBAC | **nothing**                                                                      |

So a shared deployment either exposes the launch URL (anyone holding it is the owner) or puts a login
gate in front of it. Community gates exist, but they verify passwords against their own file; none of
them can verify against a directory. `dsh-auth-ldap` fills that gap without forking
`@deepseek-ai/dsh-host-webserver`, so it keeps working across `dsh` releases.

## What it will do

**Phase 1 - authentication gate**

- One login page, two credential backends: local password file, LDAP/AD `search-then-bind`.
- Group mapping: directory groups map to `admin` / `operator` / `viewer` roles.
- Signed, `HttpOnly` session cookies with a server-side session table (revocable, TTL-bounded).
- Every HTTP route, `/api` call, and WebSocket upgrade is gated, including plugin-registered routes.
- `observe` mode: log the decision without denying, so a rollout can be staged.
- Unauthenticated `/auth-ldap/status` document for smoke tests and monitoring.

**Phase 2 - per-user isolation (separate milestone)**

`dsh` is a single-tenant runtime: sessions, workspaces, and credentials live under one `$DSH_HOME`.
Authenticating ten people therefore still shares one environment. Phase 2 partitions that per
principal. It is deliberately out of scope here; see
[docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md#phase-2-per-user-isolation).

## Requirements

- Node.js `>= 22.19.0` (the `dsh` launcher pins its own runtime; this is the plugin's floor).
- `dsh >= 0.2.2-rc.1`. `dsh` is pre-stable, so pin a tested range before relying on it.
- An LDAP v3 directory (OpenLDAP, LLDAP, 389 DS, Active Directory) reachable over LDAPS or STARTTLS.

Developing the plugin also needs **pnpm 12**, pinned through `packageManager` in `package.json`. Enable
Corepack once (`corepack enable`) and `pnpm` resolves to the pinned version automatically; or install it
directly with `npm i -g pnpm@12`.

## Install

```sh
pnpm dlx @deepseek-ai/dsh plugin --profile web add dsh-auth-ldap   # from the npm registry (once published)
pnpm dlx @deepseek-ai/dsh plugin --profile web add github:<owner>/dsh-auth-ldap   # from a git checkout
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` inserts the plugin row into the profile
automatically. If `dsh` is already on your `PATH`, drop the `pnpm dlx @deepseek-ai/dsh` prefix and call
`dsh plugin ...` directly.

Deployment values live in the profile's user layer:

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

Restart the profile after editing the user layer, then check the deployment:

```sh
curl -s http://127.0.0.1:3080/auth-ldap/status
```

## Usage

Start the profile the plugin was added to:

```sh
dsh web                      # same as: dsh --profile web
```

Then, in the browser:

| Step                 | What happens                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Open the printed URL | `dsh` prints `http://127.0.0.1:3080/?token=...`; the launch token is still the owner credential |
| Reach the login page | From M1 on, unauthenticated requests are redirected to `loginPath`                              |
| Sign in              | Local account, or directory account via search-then-bind                                        |
| Use the GUI          | The admitted session races the launch-token cookie; either grants access until it expires       |

Operational commands:

```sh
curl -s http://127.0.0.1:3080/auth-ldap/status          # deployment shape, no secrets
dsh plugin --profile web remove dsh-auth-ldap           # uninstall
```

Until M1 lands, the plugin only serves the status route; the GUI still admits by launch token alone.

## Configuration

| Key                                               | Default                        | Meaning                                                                                                   |
| ------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `mode`                                            | `observe`                      | `gate` denies unauthenticated requests; `observe` only logs. Flips to `gate` in 0.2.0 when the gate ships |
| `publicHost`                                      | `""`                           | Host shown on the login page; empty falls back to the request `Host`                                      |
| `loginPath` / `logoutPath`                        | `/auth/login` / `/auth/logout` | Gate endpoints                                                                                            |
| `statusPath`                                      | `/auth-ldap/status`            | Unauthenticated status document                                                                           |
| `trustedProxyCidrs`                               | `[]`                           | Proxies whose forwarded client-IP header is trusted                                                       |
| `local.enabled`                                   | `false`                        | Enable the local account file                                                                             |
| `local.usersFile`                                 | `""`                           | Absolute path to the account file                                                                         |
| `ldap.enabled`                                    | `false`                        | Enable directory login                                                                                    |
| `ldap.url`                                        | `""`                           | `ldaps://host[:port]` or `ldap://host[:port]`                                                             |
| `ldap.userSearchBase`                             | `""`                           | Base DN searched for the login account                                                                    |
| `ldap.userSearchFilter`                           | `(uid={{username}})`           | User filter; `{{username}}` is RFC 4515 escaped                                                           |
| `ldap.bindDn` / `ldap.bindPasswordEnv`            | `""`                           | Service account for the search; empty means anonymous                                                     |
| `ldap.displayNameAttribute`                       | `displayName`                  | Attribute used as the display name                                                                        |
| `ldap.groupSearchBase` / `ldap.groupSearchFilter` | `""` / `(member={{dn}})`       | Group mapping query                                                                                       |
| `ldap.adminGroups`                                | `[]`                           | Groups whose members get the `admin` role                                                                 |
| `ldap.startTls`                                   | `false`                        | Upgrade `ldap://` with STARTTLS                                                                           |
| `ldap.rejectUnauthorized`                         | `true`                         | Verify the directory certificate                                                                          |
| `ldap.timeoutMs`                                  | `10000`                        | Connect and search timeout                                                                                |
| `session.cookieName`                              | `dsh_auth_ldap`                | Session cookie name                                                                                       |
| `session.ttlSeconds`                              | `43200`                        | Absolute session lifetime                                                                                 |
| `session.secure`                                  | `true`                         | Emit the `Secure` attribute                                                                               |

Configuration is validated twice: the schema rejects wrong shapes and ranges at load time, and
`validateConfig` rejects combinations such as "LDAP enabled but no search base" or "cleartext LDAP
without STARTTLS". Those failures stop the mount. Deployment smells - no backend configured, local
accounts as the only backend, disabled certificate verification - are logged as warnings so the
plugin still mounts and can be diagnosed from a running instance.

## Security model

The full threat model is in [docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md).
The short version:

- Passwords are verified and then discarded; nothing is stored except a scrypt hash for local accounts.
- Session cookies are signed (`HMAC-SHA256`), `HttpOnly`, `SameSite=Lax`, and `Secure` by default.
- Sessions are revocable server-side; deleting a session or disabling an account ends access.
- Login names are escaped per RFC 4515 before entering a directory filter.
- Failed logins are rate limited per account and per client address; the response does not reveal
  whether the account exists.
- Forwarded client-IP headers are ignored unless the direct peer is in `trustedProxyCidrs`.

Report vulnerabilities per [SECURITY.md](SECURITY.md), not in a public issue.

## Development

```sh
corepack enable      # once; pnpm then follows packageManager in package.json
pnpm install
pnpm verify          # typecheck + lint + format check + tests + build
pnpm test            # vitest
pnpm run test:watch  # vitest in watch mode
pnpm run build       # tsc -> lib/
pnpm run format      # prettier --write .
```

`pnpm verify` is what CI runs on Node 22 and 24; run it before every commit. `pnpm-lock.yaml` is
committed, and CI installs with `--frozen-lockfile`.

Layout:

```
src/config.ts        schema, defaults, cross-field validation
src/principal.ts     the plugin's PrincipalMap entry
src/routes/          HTTP handlers
src/gate/            request admission (M1)
src/session/         signed cookies + session table (M1)
src/backends/        local account file, LDAP bind (M1, M2)
test/                unit tests, mirroring src/
docs/design/         design notes
docs/adr/            architecture decision records
```

Process, branching, and commit rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Agent-facing
conventions are in [AGENTS.md](AGENTS.md).

## License

MIT - see [LICENSE](LICENSE).
