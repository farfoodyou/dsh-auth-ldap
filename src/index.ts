/**
 * `dsh-auth-ldap` plugin entry: a walking skeleton for the authentication gate.
 *
 * Mounted through a bundle patch into the `web` profile. Milestone M0 registers
 * only the unauthenticated status route used by smoke tests; the gate, session
 * store, and credential backends land in M1 and later (see `docs/roadmap.md`).
 * @module dsh-auth-ldap
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { Config, validateConfig } from './config.js'
import { createStatusHandler } from './routes/status.js'

/** Stable Cordis plugin name; also the row id in `cordis.patch.yml`. */
export const name = 'dsh-auth-ldap'

/** The gate owns HTTP routes, so it requires the web server service. */
export const inject = ['webServer'] as const

export { Config, validateConfig }
export type {
  Config as AuthConfig,
  GateMode,
  LdapBackendConfig,
  LocalBackendConfig,
  SessionConfig,
} from './config.js'
export { createAuthPrincipal, isAuthPrincipal } from './principal.js'
export type { AuthBackend, AuthPrincipal, AuthPrincipalInput } from './principal.js'
export { createStatusHandler, statusPayload, PHASE } from './routes/status.js'
export type { StatusPayload } from './routes/status.js'

/**
 * Mount the plugin into the composing profile.
 *
 * Configuration is validated before any route is registered so that a
 * misconfigured deployment fails at load time instead of at the first login
 * attempt.
 * @param ctx - plugin scope owning this plugin's registrations.
 * @param config - validated configuration supplied by the loader.
 * @throws when the configuration is internally inconsistent.
 */
export function apply(ctx: Context, config: Config): void {
  const problems = validateConfig(config)
  if (problems.length > 0) {
    throw new Error(`dsh-auth-ldap: invalid configuration: ${problems.join('; ')}`)
  }

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
  })
}
