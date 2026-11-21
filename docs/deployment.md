# Deployment guide

[English](deployment.md) | [中文](deployment.zh.md)

How to run this plugin on a real host: one `systemd` unit, one profile, one reverse proxy. The
reference deployment is a LAN-only instance reachable as `dsh.example.com` behind a TLS-terminating
proxy; adjust the placeholders to your environment.

Every value below is a placeholder. Never commit a real hostname, directory DN, or password.

## 1. What runs where

```
browser ──HTTPS──▶ reverse proxy (:443, TLS) ──HTTP──▶ dsh web (:3080, loopback or LAN address)
                          │                                  │
                          └─ forwards Host, adds X-Forwarded-For
                                                             └─ dsh-auth-ldap gates pages and /api
```

- `dsh` serves plain HTTP. If the proxy terminates TLS, keep `session.secure` at its default and let
  the plugin decide per request (a `Secure` cookie is dropped by the browser on a plain-HTTP origin, so
  signing in through `http://host:3080` only works because the attribute follows the request scheme).
- Bind the listener to the address the proxy actually reaches, never `0.0.0.0` (dsh rejects wildcard
  addresses itself).

## 2. Install or upgrade `dsh`

`dsh` has no self-update command. It lives in a pinned Node tree, so an upgrade is a global install
into that tree:

```sh
export PATH="$HOME/.local/share/node24/current/bin:$PATH"
DEST="$HOME/.local/share/node24/current"

# check what is installed and what exists
dsh --version
npm view @deepseek-ai/dsh dist-tags --json

# upgrade (or install) — see the script warning below
npm i -g @deepseek-ai/dsh@<version> --prefix "$DEST" --no-audit --no-fund \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs

dsh --version
systemctl --user restart dsh-web
```

If the host needs an HTTP proxy for npm, export it for the install only:

```sh
export http_proxy=http://proxy.example.com:7890 https_proxy=$http_proxy
```

### The `--allow-scripts` trap

npm 12 blocks lifecycle scripts unless they are allowlisted. A `dsh` install that skips them looks
successful and then breaks at runtime:

| Package                             | Script                       | Symptom when blocked                   |
| ----------------------------------- | ---------------------------- | -------------------------------------- |
| `@deepseek-ai/dsh-subprocess-local` | `postinstall` (spawn helper) | the agent's bash/subprocess tool fails |
| `node-pty`                          | `install`                    | the terminal panel fails               |
| `koffi`                             | `install`                    | FFI-backed features fail               |
| `@google/genai`, `protobufjs`       | `preinstall` / `postinstall` | provider or protobuf calls fail        |

`npm` prints a warning listing them; pass the list to `--allow-scripts` as shown above. Verify after
the install:

```sh
DEST="$HOME/.local/share/node24/current/lib/node_modules/@deepseek-ai/dsh"
ls "$DEST/node_modules/node-pty/prebuilds/"          # expect linux-x64 and friends
dsh --profile headless "run: echo ok"                # exercises subprocess end to end
```

### Rollback

```sh
npm i -g @deepseek-ai/dsh@<previous-version> --prefix "$DEST" --no-audit --no-fund \
  --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs
systemctl --user restart dsh-web
```

Keep the previous `package.json` version noted before upgrading; nothing else is needed because the
profile, sessions, and credentials live outside the install tree.

## 3. The service unit

`~/.config/systemd/user/dsh-web.service`:

```ini
[Unit]
Description=DeepSeek Harness (dsh) web UI — https://dsh.example.com/
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h
EnvironmentFile=%h/.dsh/ldap.env
ExecStart=%h/.local/bin/dsh --profile web --host 192.0.2.10 --port 3080 --no-open \
  --public-url https://dsh.example.com/ --trusted-host dsh.example.com
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.dsh/logs/dsh-web.log
StandardError=append:%h/.dsh/logs/dsh-web.log

[Install]
WantedBy=default.target
```

```sh
mkdir -p ~/.dsh/logs
systemctl --user daemon-reload
systemctl --user enable --now dsh-web
loginctl enable-linger "$USER"      # start at boot without an interactive login
systemctl --user status dsh-web
```

`Linger=yes` is what makes the unit survive a reboot: without it a `systemd --user` unit only starts
when someone logs in.

`EnvironmentFile` holds the directory service account password (`DSH_LDAP_BIND_PASSWORD=...`, mode
`0600`). Add `Environment=NODE_EXTRA_CA_CERTS=/path/to/ca.crt` if you prefer the process trust store
over `ldap.caFile`.

## 4. Install the plugin into the profile

```sh
dsh plugin --profile web add dsh-auth-ldap        # from npm, once published
dsh plugin --profile web add /path/to/checkout    # from a local checkout
```

Configuration goes in the profile's user layer, which is applied after every bundle layer:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-auth-ldap
  config:
    mode: gate
    # the proxy in front of this instance; without it every client shares one
    # rate-limit bucket and one attacker locks everybody out
    trustedProxyCidrs: ['192.0.2.200/32']
    clientIpHeader: x-forwarded-for
    local:
      enabled: true
      usersFile: /home/dsh/.dsh/storages/auth-ldap/users.json
    ldap:
      enabled: true
      url: ldaps://192.0.2.20:636
      userSearchBase: ou=people,dc=corp,dc=example,dc=com
      userSearchFilter: (uid={{username}})
      bindDn: cn=svc-dsh,ou=service,dc=corp,dc=example,dc=com
      bindPasswordEnv: DSH_LDAP_BIND_PASSWORD
      caFile: /etc/pki/ca-trust/source/anchors/corp-ca.crt
      groupSearchBase: ou=groups,dc=corp,dc=example,dc=com
      groupSearchFilter: (member={{dn}})
      groupNameAttribute: cn
      adminGroups: [dsh-admins]
      startTls: false
      rejectUnauthorized: true
```

Create the local break-glass account before enabling `gate` reasoning on it:

```sh
printf '%s' 'change-me' | dsh-auth-ldap add operator --role admin
dsh-auth-ldap list
```

## 5. State on disk

| Path                                      | Contents                            | Back up          |
| ----------------------------------------- | ----------------------------------- | ---------------- |
| `~/.dsh/storages/auth-ldap/users.json`    | local accounts, scrypt records only | yes              |
| `~/.dsh/storages/auth-ldap/session.key`   | session signing key                 | yes              |
| `~/.dsh/storages/auth-ldap/sessions.json` | live sessions                       | no (regenerated) |
| `~/.dsh/storages/auth-ldap/audit.log`     | login decisions                     | optional         |
| `~/.dsh/ldap.env`                         | service account password            | yes, secret      |
| `~/.dsh/profiles/web/cordis.patch.yml`    | plugin configuration                | yes              |
| `~/.config/systemd/user/dsh-web.service`  | the unit                            | yes              |
| `~/.dsh/.credentials.yaml`                | dsh browser-session signing secret  | yes              |

```sh
tar czf ~/backups/dsh-config-$(date +%F).tgz \
  .dsh/storages/auth-ldap .dsh/profiles/web/cordis.patch.yml .dsh/ldap.env \
  .dsh/.credentials.yaml .config/systemd/user/dsh-web.service
```

Losing `users.json` or `session.key` does not lock the operator out: the process launch token printed
at startup remains break-glass access.

## 6. Upgrade checklist

Run this after every `dsh` upgrade, because the plugin wraps service methods whose behaviour is not
guaranteed across release candidates:

```sh
H=https://dsh.example.com

curl -s "$H/auth-ldap/status"                                   # 1 plugin mounted, backends enabled
curl -s -o /dev/null -w '%{http_code}\n' "$H/"                  # 2 303 to the login page
curl -si -H 'Origin: '$H -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=operator&password=change-me' "$H/auth/login" | head -1   # 3 303
curl -si -H 'Origin: '$H -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=<directory-user>&password=wrong' "$H/auth/login" | head -1  # 4 401
curl -s -o /dev/null -w '%{http_code}\n' "$H/api/<any>"          # 5 401 without a session
dsh --profile headless "run: echo ok"                            # 6 subprocess still works
```

Then confirm with the browser that the application document loads after sign-in, and check
`~/.dsh/logs/dsh-web.log` for `gate mounted`.

If a check fails, roll back the `dsh` version (section 2) and restart; the plugin state does not change.

## 7. Troubleshooting

| Symptom                                                                 | Cause                                                                      | Fix                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sign-in succeeds, then you are back on the login page                   | `Secure` cookie dropped because the page was served over plain HTTP        | reach the instance over HTTPS, or let `session.secure` follow the request scheme (default) |
| `Too many attempts` for everybody at once                               | no `trustedProxyCidrs`, so all clients share the proxy's rate-limit bucket | configure `trustedProxyCidrs` and `clientIpHeader`                                         |
| `dsh: warning: 1 entry did not activate`                                | configuration rejected, so the plugin is not mounted                       | read the reason in `~/.dsh/logs/dsh-web.log`, then fix the user layer                      |
| Nothing in `journalctl`, no plugin output                               | the harness logger needs a registered exporter                             | read `~/.dsh/logs/dsh-web.log` (unit redirect) and `storages/auth-ldap/audit.log`          |
| Directory login fails with `unavailable`                                | TLS, service bind, or reachability                                         | run the commands in [ldap-integration.md](ldap-integration.md#6-verification)              |
| Directory login fails with `invalid-credentials` for a correct password | wrong login attribute, or the user is outside `userSearchBase`             | confirm the filter and base with `ldapsearch`                                              |
| STARTTLS disconnects (`ECONNRESET`) while `openssl -starttls` works     | `ldaps://` is the supported path on some servers                           | switch `ldap.url` to `ldaps://host:636` and set `startTls: false`                          |
| Agent tools fail after an upgrade                                       | lifecycle scripts were blocked                                             | reinstall with `--allow-scripts` (section 2)                                               |
