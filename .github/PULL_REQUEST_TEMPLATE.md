<!-- Keep the title in Conventional Commit form, e.g. "feat(ldap): issue sessions after search-then-bind". -->

## What changed

<!-- One paragraph. Describe behaviour, not file lists. -->

## Why

<!-- The problem this solves, and why this approach over the alternatives. -->

## How it was verified

<!-- Commands run, manual checks, and the /auth-ldap/status document when mounting changed. -->

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] Behaviour changes have tests; bug fixes have a regression test
- [ ] `CHANGELOG.md` updated under `Unreleased` (user-visible changes)
- [ ] `README.md` and `README.zh.md` updated together (install, configuration, status)
- [ ] ADR added or revised under `docs/adr/` (architectural decisions)
- [ ] No credentials, real hostnames, internal DNs, or customer data anywhere in the diff
- [ ] `engines.dsh` still matches the versions tested in CI
- [ ] Wrapped `dsh` seams are restored by their disposer and covered by a test
