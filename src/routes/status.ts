/**
 * Unauthenticated status document used by smoke tests and monitoring.
 *
 * The handler deliberately exposes only deployment shape, never directory
 * endpoints, bind DNs, account paths, or anything derived from a credential.
 * @module dsh-auth-ldap/routes/status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Config } from '../config.js'

/** Current implementation milestone, surfaced so deployments can prove which build runs. */
export const PHASE = 'm1-gate-local'

/** Machine-readable status document. */
export interface StatusPayload {
  /** Stable plugin identifier. */
  readonly plugin: 'dsh-auth-ldap'
  /** Implementation milestone of the running build. */
  readonly phase: string
  /** Gate behaviour for unauthenticated requests. */
  readonly mode: Config['mode']
  /** Which credential backends are enabled. */
  readonly backends: { readonly local: boolean; readonly ldap: boolean }
  /** Cookie name and lifetime; both are public knowledge to the browser. */
  readonly session: { readonly cookieName: string; readonly ttlSeconds: number }
}

/**
 * Project configuration onto the public status document.
 * @param config - validated plugin configuration.
 * @returns the status document; never contains secrets or endpoints.
 */
export function statusPayload(config: Config): StatusPayload {
  return {
    plugin: 'dsh-auth-ldap',
    phase: PHASE,
    mode: config.mode,
    backends: { local: config.local.enabled, ldap: config.ldap.enabled },
    session: { cookieName: config.session.cookieName, ttlSeconds: config.session.ttlSeconds },
  }
}

/**
 * Create the HTTP handler for the status route.
 * @param config - validated plugin configuration captured at mount time.
 * @returns a handler that answers `GET` and `HEAD` with the status document.
 */
export function createStatusHandler(
  config: Config,
): (request: IncomingMessage, response: ServerResponse) => void {
  const body = `${JSON.stringify(statusPayload(config))}\n`
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body).toString(),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  } as const

  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
      response.end()
      return
    }
    response.writeHead(200, headers)
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}
