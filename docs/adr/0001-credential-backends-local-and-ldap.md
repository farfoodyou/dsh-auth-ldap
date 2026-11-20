# ADR 0001 - One plugin, two credential backends

Status: accepted
Date: 2026-11-20

## Context

A deployment needs local accounts (recovery, service identities, people who are not in the
directory) and directory accounts (everyone else). Existing community gates implement one mechanism
each: password file, shared token, or - via a forked web server - an LDAP method. Splitting local and
directory login into two plugins would put two login pages, two cookie formats, and two admission
providers in front of one GUI.

## Decision

Ship a single plugin with a `CredentialBackend` interface and two implementations:

```ts
export interface CredentialBackend {
  readonly kind: 'local' | 'ldap'
  verify(input: CredentialInput): Promise<BackendResult>
}
```

The gate owns the login page, the session store, and admission. Backends own only credential
verification. Backend order is configuration (`local` before `ldap` by default) so that a directory
outage cannot lock an operator out of their own instance.

## Consequences

- Positive: one login page, one session format, one audit stream, one place to fix a vulnerability.
- Positive: a third backend (OIDC, PAM, RADIUS) is additive, not a second gate.
- Negative: the plugin carries the union of both backends' dependencies and configuration surface.
- Negative: ambiguous login names (present in both stores) need a documented precedence rule; the
  plugin documents "local wins" and logs which backend claimed the name.

## Alternatives considered

- **Two plugins.** Rejected: duplicated admission logic is the part most likely to be wrong.
- **Fork `dsh-host-webserver` (the `dsh-web-auth` approach).** Rejected: every upstream change becomes
  a conflict, and the fork must be reinstalled over a `dsh` package.
- **Directory only, no local accounts.** Rejected: breaks break-glass access when the directory is down.
