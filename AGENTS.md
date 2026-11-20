# AGENTS.md

Guidance for automated and human contributors working in this repository.

## What this repository is

A `dsh` (DeepSeek Harness) plugin that adds an authentication gate with two credential backends:
a local account file and LDAP/Active Directory bind. It targets the `web` profile. Read
[README.md](README.md) and [docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md)
before changing `src/`.

Current milestone: see [docs/roadmap.md](docs/roadmap.md). Check which boxes are open before assuming a
module exists - several directories in the design note are not created yet.

## Non-negotiable conventions

1. **English in code.** Identifiers, comments, doc comments, test names, log and error strings. Chinese
   appears only in `README.zh.md` and `CONTRIBUTING.zh.md`.
2. **Bilingual user documentation.** Any change to install, configuration, status, or behaviour updates
   both `README.md` and `README.zh.md` in the same change.
3. **Conventional Commits**, enforced by `commitlint`; see [CONTRIBUTING.md](CONTRIBUTING.md).
4. **No secrets or real infrastructure.** No real hostnames, DNs, passwords, hashes, or tokens in code,
   tests, docs, or fixtures.
5. **Never fork or patch a `dsh` package.** Use documented seams only: `webServer.register`,
   `webServer.registerFallback`, `webserver/request`, `webserver/upgrade`,
   `context.connection.authentication.register`, `context.connection.createPeer`, the credentials seam.
   The published `0.2.2-rc.x` `WebRoute` has **no** `auth` field - do not write code that assumes one.
6. **`authenticate()` is synchronous.** Credential verification that needs the network belongs in the
   login route; admission only verifies a signed cookie and a session lookup.
7. **Restore what you patch.** Every wrapper installed on `webServer` must be removed by the disposer
   returned to `ctx.effect`, and covered by a test that asserts the original is back.

## Commands

```sh
npm install          # once
npm run verify       # typecheck + lint + format:check + test + build (run before every commit)
npm test             # vitest run
npm run test:watch
npm run build        # tsc -> lib/
npm run format       # prettier --write .
```

## Layout rules

- One module per file; the file's `@module` doc comment names it.
- `src/config.ts` is the only place that defines configuration fields, defaults, and cross-field
  validation. Tests for new fields belong in `test/config.spec.ts`.
- HTTP handlers are pure functions of `(config) -> (request, response)` and carry no module state, so
  they can be unit-tested without a server.
- Public modules export explicit types; internal helpers stay unexported.
- `docs/design/` and `docs/adr/` are written before behaviour that they govern. If code and a design
  note disagree, fix one of them in the same change.

## Manual smoke test

```sh
# in a checkout of the plugin
npm run build

# point a disposable profile at the checkout
dsh plugin --profile web add "$PWD"

# restart the profile, then
curl -s http://127.0.0.1:3080/auth-ldap/status
```

Record the observed document in the pull request when a change affects mounting or configuration.
Remember to remove the plugin from the profile afterwards (`dsh plugin --profile web remove dsh-auth-ldap`).

## Things that look like bugs but are not

- Authenticated users share one workspace, one session list, and one model credential. That is the
  documented single-tenant behaviour of `dsh`; per-user isolation is phase 2.
- The status route is unauthenticated. It must never expose directory endpoints, bind DNs, account
  paths, or anything derived from a credential.
