# Security policy

## Reporting a vulnerability

Do **not** open a public issue for a security problem, and do not include credentials, real directory
endpoints, or customer data in a report.

Report privately through GitHub's [security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
flow on this repository. Include:

- affected version and `dsh` version,
- the `/auth-ldap/status` document (it carries no secrets),
- reproduction steps with secrets replaced by placeholders,
- your assessment of impact.

Expect an acknowledgement within seven days. This is a volunteer project: fixes are best effort, and
we will credit reporters who want credit.

## Supported versions

| Version | Supported               |
| ------- | ----------------------- |
| 0.1.x   | Yes (developer preview) |

Until 1.0.0 the plugin is a developer preview. It is not audited and should not front an
internet-exposed instance without an independent review.

## Security expectations for deployments

These are requirements, not recommendations:

1. Serve the browser leg over HTTPS. Set `session.secure: true` (the default) and terminate TLS at the
   listener or at a proxy that forwards `Host` unchanged.
2. Never expose the `dsh` port directly to the internet. Bind the listener to loopback or a private
   interface and let the gate decide admission.
3. Populate `trustedProxyCidrs` with the exact proxies in front of the instance, and set
   `clientIpHeader` to the header that proxy writes. Leaving the list empty means forwarded headers are
   ignored: every request behind a proxy is then bucketed by the proxy address, which turns one
   attacker's five failures into a shared cooldown.
4. Use `ldaps://` or `startTls: true`. `rejectUnauthorized: false` is for lab use only and is logged as
   a warning on every mount.
5. Give the service account read-only search rights. It never needs write access.
6. Keep the account file (`local.usersFile`) at mode `0600`, owned by the account that runs `dsh`.
7. Rotate the directory service account password like any other credential, and rotate the session
   signing key with the documented command after staff departures.

## Scope

In scope: authentication bypass, session forgery or fixation, CSRF on state-changing routes, LDAP
injection, credential or secret disclosure through logs, status documents, or error messages, privilege
escalation through role mapping.

Out of scope: denial of service through resource exhaustion on the `dsh` side, vulnerabilities in
`dsh` itself (report those upstream), and the known single-tenant limitation described in
[docs/design/0001-authentication-gate.md](docs/design/0001-authentication-gate.md#phase-2-per-user-isolation)

- an authenticated user seeing the shared workspace is the documented phase 1 behaviour.
