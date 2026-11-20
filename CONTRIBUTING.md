# Contributing

[English](CONTRIBUTING.md) | [中文](CONTRIBUTING.zh.md)

Thanks for helping. This repository is small, so the process is short but enforced by CI.

## Ground rules

- **English everywhere in code**: identifiers, comments, doc comments, commit messages, test names,
  log strings, and error messages. Only user-facing documentation is bilingual.
- **No secrets in the tree**: no real directory endpoints, bind DNs, passwords, or hashes. Test
  fixtures use obviously fake values.
- **Tests come with behaviour**: a pull request that changes behaviour without a test is not merged.
- **One concern per pull request**: a refactor and a feature in the same branch makes review harder and
  history unreadable.
- **No forking a `dsh` package.** Use documented seams only; if a seam is missing, open an issue first.

## Branching

`main` is always releasable. Work happens on short-lived branches named after the change:

```
feat/<short-slug>      new behaviour
fix/<short-slug>       defect repair
docs/<short-slug>      documentation only
refactor/<short-slug>  no behaviour change
chore/<short-slug>     tooling, dependencies, CI
```

Rebase onto `main` before requesting review; do not merge `main` into a branch to resolve conflicts.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by `commitlint`:

```
<type>(<scope>): <imperative summary>

<optional body: why, not what>

<optional footer: BREAKING CHANGE: ...>
```

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- Scopes: `gate`, `session`, `backends`, `local`, `ldap`, `config`, `docs`, `ci`, `deps`, `release`.
- Subject in the imperative mood, lower case, no trailing period, at most 100 characters.
- One logical change per commit; a commit must build and pass tests on its own.

Check the last commit message locally:

```sh
pnpm exec commitlint --from HEAD~1 --to HEAD
```

## Package manager

This repository uses **pnpm** only. `packageManager` in `package.json` pins the version, and
`pnpm-lock.yaml` is committed; `package-lock.json` and `yarn.lock` must never appear in a pull request.
Run commands through `pnpm` (`pnpm run build`, `pnpm exec commitlint`) so that every contributor and CI
resolve the same dependency graph.

## Pull requests

Before opening one:

```sh
pnpm verify
```

The checklist in `.github/PULL_REQUEST_TEMPLATE.md` mirrors the review criteria:

1. `pnpm verify` passes locally.
2. Behaviour changes have tests; bug fixes have a regression test.
3. `CHANGELOG.md` has an entry under `Unreleased` when the change is user-visible.
4. README (both languages) is updated when configuration, installation, or status changes.
5. An ADR is added under `docs/adr/` when an architectural decision is made or revised.
6. No credential material, real hostnames, or internal DNs appear in code, tests, or docs.
7. The compatibility statement (`engines.dsh`) still reflects what CI tested.

A reviewer asks for changes or approves; the author merges with a squash merge and the PR title as the
commit subject. Force-pushing to `main` is forbidden.

## Releases

1. Update `CHANGELOG.md`: move `Unreleased` entries into a version section with today's date.
2. Bump `version` in `package.json` (semver: behaviour change -> minor while pre-1.0, fix -> patch).
3. Tag `v<version>` on `main` and push the tag.
4. Publish with `pnpm publish` (requires 2FA); the `prepack` script builds `lib/` with `tsc`.
5. Open a pull request that moves `Unreleased` back to an empty section.

## Documentation layout

| Location          | Language | Purpose                                                   |
| ----------------- | -------- | --------------------------------------------------------- |
| `README.md`       | English  | Entry point, install, configuration, status               |
| `README.zh.md`    | Chinese  | Same content, kept in sync                                |
| `docs/design/`    | English  | One note per subsystem; the source of truth for behaviour |
| `docs/adr/`       | English  | Decisions with context and rejected alternatives          |
| `docs/roadmap.md` | English  | Milestones and their acceptance criteria                  |
| `AGENTS.md`       | English  | Conventions for automated contributors                    |

When a design note and the code disagree, that is a bug: fix one of them in the same pull request.

## Reporting bugs

Open an issue with the template. Include the `dsh` version, the plugin version, the `/auth-ldap/status`
document (it carries no secrets), and the relevant log lines with credentials removed. Security issues
go to [SECURITY.md](SECURITY.md) instead.
