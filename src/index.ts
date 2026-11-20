/**
 * `dsh-auth-ldap` plugin entry.
 *
 * Milestone M1: a real gate with local accounts. A browser session is proved by
 * a signed cookie backed by a server-side session table, so admission stays
 * synchronous; the password file is read only at login. The directory backend
 * lands in M2 and is currently rejected at configuration time.
 * @module dsh-auth-ldap
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Config } from './config.js'
import { configWarnings, validateConfig } from './config.js'
import { installGate } from './gate.js'
import { createLoginHandler, createLogoutHandler } from './routes/login.js'
import { createStatusHandler } from './routes/status.js'
import { SessionCookie, SessionStore, loadOrCreateSecret } from './session.js'
import { type UsersFile, loadUsers } from './users.js'

/** Stable Cordis plugin name; also the row id in `cordis.patch.yml`. */
export const name = 'dsh-auth-ldap'

/** The gate needs both the HTTP server and the connection service that admits requests. */
export const inject = ['webServer', 'connection'] as const

export { Config, configWarnings, validateConfig } from './config.js'
export type {
  Config as AuthConfig,
  GateMode,
  LdapBackendConfig,
  LocalBackendConfig,
  SessionConfig,
  StorageConfig,
} from './config.js'
export { createAuthPrincipal, isAuthPrincipal } from './principal.js'
export type { AuthBackend, AuthPrincipal, AuthPrincipalInput } from './principal.js'
export { createLoginHandler, createLogoutHandler, safeNext } from './routes/login.js'
export { createStatusHandler, statusPayload, PHASE } from './routes/status.js'
export type { StatusPayload } from './routes/status.js'
export { SessionCookie, SessionStore, loadOrCreateSecret } from './session.js'
export type { SessionInput, SessionRecord, CookiePayload } from './session.js'
export { authenticateLocal, findAccount, loadUsers, saveUsers } from './users.js'
export type { Account, UsersFile } from './users.js'
export { hashPassword, verifyPassword } from './password.js'
export type { PasswordRecord } from './password.js'

/**
 * Resolve `$DSH_HOME`, defaulting to `~/.dsh`.
 * @returns absolute home directory.
 */
export function dshHome(): string {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Resolve the directory holding the signing key and session table.
 * @param configured - `storage.dir` from configuration; empty for the default.
 * @returns absolute directory.
 */
export function resolveStorageDir(configured: string): string {
  if (configured !== '') return expandHome(configured)
  return join(dshHome(), 'storages', 'auth-ldap')
}

/**
 * Resolve the account file path.
 * @param configured - `local.usersFile` from configuration.
 * @returns absolute path.
 */
export function resolveUsersFile(configured: string): string {
  return expandHome(configured)
}

/**
 * Expand a leading `~` and make the path absolute.
 * @param path - configured path.
 * @returns absolute path.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(path)
}

/**
 * Mount the plugin into the composing profile.
 *
 * Invalid configuration stops the mount so a broken deployment fails at load
 * time instead of at the first login attempt. Deployment smells are logged and
 * the mount continues, because a plugin that refuses to load cannot be
 * diagnosed from the running instance.
 * @param ctx - plugin scope owning this plugin's registrations.
 * @param config - validated configuration supplied by the loader.
 * @throws when the configuration is internally inconsistent.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const problems = validateConfig(config)
  if (problems.length > 0) {
    throw new Error(`dsh-auth-ldap: invalid configuration: ${problems.join('; ')}`)
  }

  const warn = (message: string): void => ctx.logger.warn('dsh-auth-ldap: %s', message)
  for (const warning of configWarnings(config)) warn(warning)

  const storageDir = resolveStorageDir(config.storage.dir)
  const secret = await loadOrCreateSecret(join(storageDir, 'session.key'))
  const store = new SessionStore(join(storageDir, 'sessions.json'))
  await store.load()
  const cookie = new SessionCookie(
    secret,
    config.session.cookieName,
    config.session.secure,
    config.session.ttlSeconds,
  )

  const usersFile = resolveUsersFile(config.local.usersFile)
  const readUsers =
    config.local.usersFile === ''
      ? (): Promise<UsersFile> => Promise.resolve({ version: 1, accounts: [] })
      : (): Promise<UsersFile> => loadUsers(usersFile)
  if (config.local.enabled) {
    const accounts = await loadUsers(usersFile)
    if (accounts.accounts.length === 0) {
      warn(`no accounts in ${usersFile}; create one with: dsh-auth-ldap add <account>`)
    }
  }

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => installGate(connectionCtx.connection, { config, cookie, store, warn }),
      'dsh-auth-ldap: admission gate',
    )
  })

  const login = createLoginHandler({ config, store, cookie, readUsers, warn })
  const logout = createLogoutHandler({ store, cookie })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: config.statusPath,
          handler: createStatusHandler(config),
        }),
      'dsh-auth-ldap: status route',
    )
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: config.loginPath, handler: login }),
      'dsh-auth-ldap: login route',
    )
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: config.logoutPath, handler: logout }),
      'dsh-auth-ldap: logout route',
    )
  })

  warn(`gate mounted in ${config.mode} mode; ${String(store.size)} live session(s)`)
}
