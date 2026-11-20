# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a
behaviour change increments the minor version and an internal change increments the patch version.

## [Unreleased]

## [0.3.2] - 2026-11-21

### Added

- Audit entries for every early login rejection (method, origin, content type, oversized body, no
  backend configured), so a browser that never reaches password verification still leaves a trace.

## [0.3.1] - 2026-11-20

### Fixed

- Rate limiting behind a reverse proxy no longer buckets every client together. `trustedProxyCidrs`
  plus the new `clientIpHeader` attribute requests to the rightmost non-proxy hop; a trusted proxy with
  no usable header skips the address budget instead of throttling everyone. Before this fix, one
  attacker's five failures locked out every user for five minutes.
- A correct password is never refused because the account budget is spent. The account budget is now
  20 failures per cooldown and only turns a wrong password into `429`; denying valid credentials would
  let anyone deny the operator service.

### Added

- `ldap.caFile` loads a PEM CA bundle, so a private directory CA no longer depends on
  `NODE_EXTRA_CA_CERTS` in the service unit.
- `<storage.dir>/audit.log`: an append-only record of mount, configuration warnings, and every login
  decision (account, client address, backend, failure class, no credential material). The harness logger
  drops plugin warnings when no exporter is registered, which made the previous release impossible to
  debug on a live instance.

## [0.3.0] - 2026-11-20

### Added

- Directory backend: `search-then-bind` over LDAPS or STARTTLS with an optional service account,
  ambiguity detection (`sizeLimit: 2`), and group-to-role mapping against `adminGroups` (common name
  or full DN, case-insensitive).
- RFC 4515 filter escaping and RFC 4514 DN escaping behind `applyFilterTemplate`, so a submitted login
  name can never widen a filter.
- Credential chain: local accounts win for a name that exists locally, other names fall through to the
  directory, so a directory account cannot shadow a local operator account.
- Failure classification (`invalid-credentials`, `ambiguous`, `unavailable`) logged per attempt, with
  every directory failure failing closed.
- `docs/ldap-integration.md` and its Chinese counterpart: the requirements sheet for the directory
  team, including the exact wire sequence, service account rights, AD and OpenLDAP specifics, and the
  limitations to disclose.
- `groupNameAttribute` configuration and `test/ldap-*.spec.ts`, `test/authenticate.spec.ts`.

### Changed

- `MIN_PASSWORD_LENGTH` (6) documents the hasher's typo floor; it is not a password policy. Directory
  strength is enforced by the directory.
- Login accepts a request when either backend is enabled and reports "no sign-in method configured"
  when neither is.

## [0.2.0] - 2026-11-20

### Added

- Admission gate: `connection.admit` and `connection.authorizeIndex` are wrapped so page documents,
  `/api` calls, and WebSocket upgrades require a session, while the process launch token keeps working
  as break-glass access. Wraps are restored on dispose.
- Login page, `POST` login, and `GET /auth/logout`, with `Origin`/`Host` checks, a 4 KiB body cap, a
  uniform failure response, and a five-attempt / five-minute throttle per account and per address.
- Signed session cookies (`HMAC-SHA256`, `HttpOnly`, `SameSite=Lax`, `Secure`) backed by a session table
  that is revocable, TTL-bounded, and persisted across restarts.
- Local account backend: scrypt records in a JSON file, constant-time verification, disabled accounts,
  and a non-enumerable failure path.
- `dsh-auth-ldap` CLI: `add`, `passwd`, `disable`, `enable`, `list`.
- `storage.dir` configuration for the signing key and session table.

### Changed

- `mode` defaults to `gate` now that the gate exists; a gate mount without a usable backend still fails
  with an actionable error.
- Deployment smells (no backend, local-only, unimplemented directory backend, disabled certificate
  verification) are logged as warnings instead of aborting the mount.

### Known limitations

- The directory backend is not implemented; `ldap.*` is validated and warns until 0.3.0.
- Every session is admitted as the shared operator peer, because `dsh` rejects non-owner principals on
  the `/api` fetch routes. Per-user identity belongs to phase 2.

## [0.1.1] - 2026-11-20

### Changed

- Build and development scripts use pnpm 12, pinned through `packageManager`; `pnpm-lock.yaml` replaces
  `package-lock.json` and CI installs with `--frozen-lockfile`.
- README (both languages) documents pnpm-based install, usage, and development commands.
- `mode` defaults to `observe` until the gate ships in 0.2.0, so the documented default no longer
  claims enforcement this milestone does not implement.

### Fixed

- A profile can mount the plugin without any credential backend configured: missing backends,
  local-only deployments, and disabled certificate verification are logged as warnings instead of
  aborting the mount, which previously left the plugin inactive after `dsh plugin add`.

## [0.1.0] - 2026-11-20

### Added

- Plugin entry point (`name`, `inject`, `Config`, `apply`) mountable through a bundle patch into the
  `web` profile.
- Configuration schema with defaults for the local backend, the LDAP backend, session policy, and
  proxy trust, plus cross-field validation of backend usability, directory URL shape, escaping
  placeholders, CIDR entries, and route paths.
- `PrincipalMap` entry for `dsh-auth-ldap:user`, with normalization (lowercased id, sorted deduped
  groups, display-name fallback) and a guard predicate.
- Unauthenticated `GET`/`HEAD` status route reporting deployment shape only.
- Repository scaffolding: TypeScript project references, vitest, ESLint with type-aware rules,
  Prettier, commitlint, GitHub Actions CI, issue and pull request templates.
- Documentation: bilingual README, contributing guide, security policy, design note for the gate,
  two ADRs, and a milestone roadmap.

[Unreleased]: https://github.com/farfoodyou/dsh-auth-ldap/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.3.2
[0.3.1]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.3.1
[0.3.0]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.3.0
[0.2.0]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.2.0
[0.1.1]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.1.1
[0.1.0]: https://github.com/farfoodyou/dsh-auth-ldap/releases/tag/v0.1.0
