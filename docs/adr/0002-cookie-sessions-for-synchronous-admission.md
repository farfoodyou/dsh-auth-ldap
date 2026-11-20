# ADR 0002 - Cookie sessions for the synchronous admission seam

Status: accepted
Date: 2026-11-20

## Context

`ctx.connection.authentication` verifies credentials **synchronously**:

```ts
authenticate(request: ConnectionTrustRequest): PeerAdmission
```

A network round trip to a directory, or a database query, cannot happen inside that call. Whatever the
gate verifies there must already be local to the process.

## Decision

Use a signed cookie plus a server-side session table:

1. On login, the backend verifies the password asynchronously and the gate creates a session record.
2. The cookie carries `id.expiry` plus an `HMAC-SHA256` signature; verification is a signature check and
   a map lookup - synchronous, cheap, and revocable.
3. Session records persist to a JSON document in the plugin's storage scope so a restart does not log
   everyone out.
4. Signing keys are stored through the credentials seam and rotated by keeping the previous key for one
   TTL, so rotation does not force a global logout.

## Consequences

- Positive: revocation is immediate (delete the record); disabling an account ends live sessions.
- Positive: no token format to parse, no algorithm negotiation, no third-party JWT library.
- Positive: the same check serves HTTP routes, `/api`, and WebSocket upgrades.
- Negative: the gate holds state; a multi-process deployment needs a shared session store (the JSON
  document is single-process, documented as such).
- Negative: cookie size is bounded, so principal data must stay small - groups are mapped to roles at
  login rather than shipped in the cookie.

## Alternatives considered

- **Self-contained JWT in the cookie.** Rejected: cannot be revoked before expiry without a server-side
  list, at which point the benefit disappears; algorithm confusion is a recurring vulnerability class.
- **Reuse the upstream `client-connection/browser-session` grant.** Rejected: that grant authenticates
  the process owner, not a directory user, and its semantics are owned by `dsh`, not by this plugin.
- **Ask the directory on every request.** Rejected: `authenticate` is synchronous.
