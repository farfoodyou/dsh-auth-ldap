# Roadmap

Each milestone is a release. "Done" means: code merged with tests, README and CHANGELOG updated,
`pnpm verify` green in CI, and the manual smoke check performed on a local `web` profile.

## M0 - scaffolding (released as 0.1.0)

- [x] Repository, licence, CI, lint/format/test/build pipeline
- [x] Configuration schema and cross-field validation
- [x] Plugin entry with a `PrincipalMap` entry for `dsh-auth-ldap:user`
- [x] Unauthenticated `/auth-ldap/status` route
- [x] Install into a real profile: mounted in a local `web` profile, `GET /auth-ldap/status` returned
      `200` with `mode: observe` both directly and through the reverse proxy

## M1 - gate, sessions, local accounts (0.2.0, shipped)

- [x] Admission wrap over `connection.admit` and `connection.authorizeIndex`, restored on dispose.
      Route registration is _not_ wrapped: the published 0.2.2-rc.x release has no per-route `auth`
      flag and no global request event, and it admits `/api` before any plugin can intervene.
- [x] Public path allowlist (`loginPath`, `logoutPath`, `statusPath`) plus break-glass launch token
- [x] Signed cookie + session store with revocation and restart persistence
- [x] Login/logout routes with `Origin`/`Host` checks, body caps, uniform failures, and throttling
- [x] Local account file backend (scrypt) and `add|passwd|disable|enable|list` CLI
- [x] `observe` mode logging
- [x] Unit coverage for the gate decisions, cookie codec, session store, password records, and handlers
- [ ] Integration test against a real `web` profile in CI (currently a manual smoke step)

## M2 - directory backend (0.3.0, shipped; awaiting directory values)

- [x] `search-then-bind` over LDAPS and STARTTLS with service account support
- [x] RFC 4515 / RFC 4514 escaping and ambiguity detection (`sizeLimit: 2`)
- [x] Group query and role mapping (`adminGroups`, common name or DN)
- [x] Directory outage semantics: fail closed, distinct audit reason
- [x] Credential chain: local accounts win for a name that exists locally
- [x] [LDAP integration sheet](ldap-integration.md) for the directory team
- [ ] Nightly integration job against a containerized OpenLDAP and a mocked Active Directory schema
- [ ] Fill in a real directory and record the verification output in the release notes

## M3 - operations (0.4.0)

- [ ] Rate limiting with per-account and per-address buckets
- [ ] Audit log stream (login, logout, deny, config change) without credential material
- [ ] Admin surface for sessions: list, revoke, disarm the gate
- [ ] Signing-key rotation command
- [ ] Metrics: logins, denials, backend latency

## M4 - hardening and documentation (1.0.0)

- [ ] Security review pass against the threat model in the design note
- [ ] Deployment guide: reverse proxy, TLS termination, `trustedProxyCidrs`, cookie scope
- [ ] Upgrade guide covering the `dsh` range this plugin supports
- [ ] Documented compatibility matrix tested in CI

## Phase 2 - per-user isolation (separate design note)

Sessions, workspaces, and credentials are partitioned per principal. The three candidate architectures
are listed in [design 0001](design/0001-authentication-gate.md#phase-2-per-user-isolation); the choice
is deferred until phase 1 runs in a real deployment.
