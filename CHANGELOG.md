# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a
behaviour change increments the minor version and an internal change increments the patch version.

## [Unreleased]

### Changed

- Build and development scripts use pnpm 12, pinned through `packageManager`; `pnpm-lock.yaml` replaces
  `package-lock.json` and CI installs with `--frozen-lockfile`.
- README (both languages) documents pnpm-based install, usage, and development commands.

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

[Unreleased]: https://github.com/OWNER/dsh-auth-ldap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/dsh-auth-ldap/releases/tag/v0.1.0
