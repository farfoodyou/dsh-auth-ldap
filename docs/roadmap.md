# Roadmap

Each milestone is a release. "Done" means: code merged with tests, README and CHANGELOG updated,
`npm run verify` green in CI, and the manual smoke check performed on a local `web` profile.

## M0 - scaffolding (released as 0.1.0)

- [x] Repository, licence, CI, lint/format/test/build pipeline
- [x] Configuration schema and cross-field validation
- [x] Plugin entry with a `PrincipalMap` entry for `dsh-auth-ldap:user`
- [x] Unauthenticated `/auth-ldap/status` route
- [ ] Install into a real profile and record the smoke-test output in the pull request

## M1 - gate, sessions, local accounts (0.2.0)

- [ ] Request guard: wrap `register`, `registerFallback`, and upgrade registration; restore on dispose
- [ ] Public path allowlist answered before admission
- [ ] Signed cookie + session store with revocation and restart persistence
- [ ] Login/logout routes with `Origin`/`Host` checks, body caps, and uniform failures
- [ ] Local account file backend (scrypt) and `user add|passwd|disable|list` CLI
- [ ] `observe` mode logging
- [ ] Integration tests against an in-process web server stub

## M2 - directory backend (0.3.0)

- [ ] `search-then-bind` over LDAPS and STARTTLS with service account support
- [ ] RFC 4515 escaping and ambiguity detection (`sizeLimit: 2`)
- [ ] Group query and role mapping (`adminGroups`)
- [ ] Directory outage semantics: fail closed, distinct audit reason
- [ ] Nightly integration job against a containerized OpenLDAP and a mocked Active Directory schema

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
