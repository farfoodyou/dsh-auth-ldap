# Design 0001 - Authentication gate for the `dsh` web profile

Status: accepted, phase 1 (M0 complete, M1 in progress)
Owners: repository maintainers

## Problem

`dsh` exposes a local web GUI served by `@deepseek-ai/dsh-host-webserver` on a loopback or LAN
address. Everything a browser can reach after admission - files, shells, model credentials, session
logs - acts with the privileges of the account that started the process. Admission today is a single
process launch token exchanged for a signed cookie; there is no account, no directory, and no
per-request identity.

Organizations that already operate an LDAP or Active Directory need the GUI reachable by several
people, with an identity the directory owns. Community gates solve "a password", not "our password
store". This document fixes the architecture for a gate that verifies credentials against a local
account file or a directory, and states explicitly what it does not do.

## Goals

1. One login page; two credential backends selectable per deployment.
2. Every HTTP route, `/api` call, and WebSocket upgrade is decided before it reaches the GUI,
   including routes registered by other plugins.
3. Sessions are revocable server-side and survive a profile restart.
4. Directory groups map to roles; admin-only surfaces can rely on those roles.
5. Rollout can be staged: `observe` mode logs decisions without denying.
6. No fork of a `dsh` package. Only documented seams are used, so `dsh` upgrades stay cheap.

## Non-goals

- Multi-tenant isolation of sessions, workspaces, or credentials (phase 2, see the last section).
- Replacing the DeepSeek `account` subsystem, billing, or quota reporting.
- Storing directory passwords, group replication, or directory write operations.
- SSO protocols other than LDAP simple bind for phase 1 (OIDC/SAML are separate work).

## How admission works in `dsh` 0.2.2-rc.x

Verified against `@deepseek-ai/dsh-host-webserver@0.2.2-rc.1` and `dsh-client-connection@0.2.2-rc.1`:

| Fact                                                                                                                                                                   | Consequence for this gate                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `WebRoute` is `{ kind, path, handler }`; the published `0.2.2-rc.x` types have **no per-route `auth` field** (that field exists only on `master`)                      | A gate cannot declare "this route is public". It must wrap registration.                |
| Routes are registered by feature plugins through `webServer.register(...)`, `registerFallback(...)`, and upgrade registrations; each returns a disposer                | The gate can substitute those methods inside its own scope and restore them on dispose. |
| `webserver/request` is an event dispatched before route dispatch, and `webserver/upgrade` before socket ownership moves to a protocol owner                            | Public endpoints (login, logout, status) are answered here, before admission.           |
| `ctx.connection.authentication.register({ authenticate(request) })` is an **ordered, synchronous** verifier registry; the first live `PeerScope` wins, otherwise `401` | Credentials must be verifiable synchronously: no network call inside `authenticate`.    |
| `ctx.connection.createPeer({ principal })` fixes a caller identity for the peer's lifetime; `PrincipalMap` is declare-merge extensible                                 | The gate mints peers with its own principal kind rather than reusing `owner`.           |

The alternative seen in the ecosystem - forking `dsh-host-webserver` to add a check to the request
pipeline - was rejected because it converts every upstream change into a merge conflict.

## Architecture

```
                ┌──────────────────────────── handleRequest ────────────────────────────┐
browser ──HTTP──▶│ webserver/request  ──▶ public path? ──yes──▶ login / logout / status │
                │        │ no                                                          │
                │        ▼                                                             │
                │ connection.authentication.authenticate(req)  ← synchronous cookie    │
                │        │ peer                                    verification          │
                │        ▼                                                             │
                │ guarded route handler (original handler, wrapped)                     │
                └──────────────────────────────────────────────────────────────────────┘
browser ──WS────▶ webserver/upgrade ──▶ same admission ──▶ protocol owner
```

Components:

| Module                  | Responsibility                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gate/guard.ts`     | Wrap `register`, `registerFallback`, and upgrade registration; decide admit/deny per request; restore the original methods on dispose |
| `src/gate/public.ts`    | The allowlist of paths answered before admission (`loginPath`, `logoutPath`, `statusPath`, static assets the served document needs)   |
| `src/session/store.ts`  | Session records: id, principal, created/expiry, revocation; in-memory index plus a durable JSON document                              |
| `src/session/cookie.ts` | `HMAC-SHA256` signing, constant-time verification, attribute policy                                                                   |
| `src/session/keys.ts`   | Signing key material stored through the credentials seam, with rotation                                                               |
| `src/backends/types.ts` | `CredentialBackend` interface: `verify(username, password, ctx)` -> principal or a typed failure                                      |
| `src/backends/local.ts` | Account file, scrypt hashes, account disable/expiry                                                                                   |
| `src/backends/ldap.ts`  | Search-then-bind, STARTTLS/LDAPS, group resolution                                                                                    |
| `src/routes/login.ts`   | Login page and form POST, CSRF and origin checks, rate limiting                                                                       |
| `src/routes/logout.ts`  | Session revocation and cookie clearing                                                                                                |
| `src/authz/roles.ts`    | Group -> role mapping and the role predicates used by admin surfaces                                                                  |

## Login flow

```
POST {loginPath}
  Origin/Host check ──▶ rate limit (account, client address) ──▶ backend chain
     local: scrypt verify against usersFile (constant-time)
     ldap : service bind ─▶ search user DN ─▶ bind as user DN ─▶ group query
  success ─▶ create principal ─▶ create session record ─▶ Set-Cookie (signed)
  failure ─▶ uniform 401 body ─▶ audit log line (account, backend, reason, source)
```

Rules:

- At most one backend may claim a login name; the local file wins so an operator can always recover
  access when the directory is unreachable. This is configurable and documented, not implicit.
- A successful login always rotates the session id; a failed login never touches an existing session.
- The POST body is size-capped, the form is `application/x-www-form-urlencoded` only, and the response
  never echoes the submitted password.
- Rate limiting is per account and per client address with independent buckets; the client address is
  the socket peer unless the peer is inside `trustedProxyCidrs`, in which case the configured
  forwarded header is read.

## Session design

| Property          | Decision                                                                                                                    | Reason                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Verification      | signed cookie -> session id -> in-memory record                                                                             | `authenticate` is synchronous                                                  |
| Signature         | `HMAC-SHA256` over `id.expiry`, constant-time compare                                                                       | no external dependency, no JWT algorithm confusion                             |
| Cookie attributes | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the browser leg is HTTPS                                                | `Lax` keeps the login POST working while blocking cross-site document requests |
| Lifetime          | absolute `ttlSeconds`, checked on every request; optional idle timeout later                                                | bounded exposure                                                               |
| Revocation        | deleting the record ends access immediately                                                                                 | disabling an account must end existing sessions                                |
| Restart           | records persisted to a JSON document under the plugin's storage scope; expired records pruned on load                       | an operator should not be logged out by a restart                              |
| Signing key       | 32 random bytes, stored through the credentials seam, rotated by writing a new key and keeping the previous one for one TTL | rotation without global logout                                                 |

Rejected alternatives are recorded in [ADR 0002](../adr/0002-cookie-sessions-for-synchronous-admission.md).

## Directory backend

`search-then-bind`, the only sequence that works across OpenLDAP, LLDAP, 389 DS, and AD without
writing directory-specific code:

1. Connect (`ldaps://` from the start, or `ldap://` + STARTTLS when `startTls` is set).
2. Bind as the service account when `bindDn` is configured; otherwise anonymous.
3. Search `userSearchBase` with `userSearchFilter`, substituting the RFC 4515-escaped login name.
4. Require exactly one entry; zero or many is a failed login with a distinct audit reason.
5. Bind as the entry DN using the submitted password. Success means the directory proved it.
6. Search `groupSearchBase` with `groupSearchFilter`, substituting the RFC 4515-escaped entry DN.
7. Map group names/DNs to roles; `adminGroups` grants `admin`.

Constraints:

- Timeouts apply to connect, search, and bind; a directory outage fails closed with a distinct
  message, never silently admitting.
- `sizeLimit: 2` on the user search detects ambiguity without transferring a directory subtree.
- The service account password is read from the environment variable named by `bindPasswordEnv`; it
  is never part of configuration, logs, or the status document.
- `rejectUnauthorized: false` is possible for lab use and logged as a warning on every mount.

## Local accounts

Account file (YAML, `0600`, owned by the `dsh` user):

```yaml
version: 1
accounts:
  - id: alice
    displayName: Alice Chen
    roles: [admin]
    password:
      scheme: scrypt
      salt: <base64>
      hash: <base64>
      params: { N: 32768, r: 8, p: 1 }
    disabled: false
```

Management is a CLI (`dsh-auth-ldap user add|passwd|disable|list`) rather than a web form: the admin
surface of the GUI is itself gated, so bootstrap must not depend on it.

## Authorization mapping

Roles are derived per login: `admin` if a membership matches `ldap.adminGroups` or the local account
lists `admin`; `operator` and `viewer` are reserved for phase 1.5 surfaces. Role checks happen at the
route boundary (`src/authz`), never in the browser. Tool-level policy (which shell commands a role may
run) is out of scope and would use `tools/pre-execute` in a later milestone.

## Threat model

| Threat                     | Mitigation                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Session cookie theft       | `HttpOnly`, `Secure`, signature, absolute TTL, server-side revocation, id rotation on login              |
| CSRF on login/logout       | `SameSite=Lax`, `Origin`/`Host` comparison on every state-changing POST                                  |
| Session fixation           | new session id on every successful login                                                                 |
| LDAP injection             | RFC 4515 escaping of `{{username}}` and `{{dn}}`; filters are configuration, values never are            |
| User enumeration           | uniform failure body and status for unknown account, wrong password, and ambiguous search                |
| Brute force                | per-account and per-address rate limits, exponential backoff, audit log                                  |
| Credential leakage in logs | passwords never logged; status document carries no endpoints; auth failures log reason codes only        |
| Spoofed client address     | forwarded headers honoured only from `trustedProxyCidrs`                                                 |
| Directory outage           | fail closed with a distinct message; no fallback to a weaker path                                        |
| Privilege confusion        | `dsh` owner sessions are not minted by this plugin; every peer it creates carries its own principal kind |

## Compatibility

`dsh` is pre-stable and publishes breaking changes between release candidates. This plugin therefore:

- pins `engines.dsh` to a tested range and widens it in a dedicated release after CI passes;
- wraps only `webServer` methods and the two documented events, and re-checks at mount that the object
  it wrapped is still the one it patched (self-check, fail fast);
- restores every patched method on dispose so plugin reload and `observe` toggling stay reversible;
- keeps adapter code isolated in `src/gate/` so an upstream change touches one directory.

## Testing strategy

| Level        | Scope                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit         | cookie signing and timing-safe compare, session store lifecycle, RFC 4515 escaping, config validation, scrypt round trip, rate limiter |
| Integration  | in-process `webServer` stub: public paths admitted, guarded routes denied without a session, denied upgrade, observe mode logging      |
| Directory    | docker `osixia/openldap` fixture in a nightly job: search-then-bind, ambiguous search, group mapping, STARTTLS                         |
| Manual smoke | install into a local `web` profile, `curl /auth-ldap/status`, log in, verify a guarded route and a WebSocket session                   |

## Phase 2 - per-user isolation

Not in phase 1. `dsh` stores sessions, workspaces, settings, and credentials under one `$DSH_HOME`;
an authenticated principal still shares them with every other principal. Options, in ascending cost:

1. **Path partitioning inside the plugin** - rewrite the storage roots per principal. Fragile: many
   `dsh` services resolve paths at boot, before a principal exists.
2. **One profile per principal** - start a second `dsh` profile per user and route by principal at the
   proxy. Operationally simple, memory-hungry, needs a supervisor.
3. **One container per principal** - the model used by multi-user portals; strongest isolation, most
   infrastructure.

The decision is deferred until phase 1 has run in a real deployment, because the answer depends on how
many concurrent users and how much per-user state the deployment actually needs.
