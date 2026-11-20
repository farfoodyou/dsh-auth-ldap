/**
 * The gate itself: admission decisions for page documents and the `/api`
 * transport.
 *
 * `dsh` 0.2.2-rc.x decides admission inside `HostConnectionService`, which the
 * static frontend and the `/api` route call directly. There is no per-route
 * `auth` flag and no global request event in that release, so the gate wraps the
 * two documented service methods and restores them on dispose. The wrap is
 * additive: the launch-token flow keeps working, so the operator can always get
 * back in even if the account file is lost.
 * @module dsh-auth-ldap/gate
 */

import type { IncomingMessage } from 'node:http'

import type { Config } from './config.js'
import type { SessionCookie } from './session.js'
import type { SessionStore } from './session.js'

/** Response face used by the index authorizer. */
interface IndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** The subset of `HostConnectionService` the gate wraps. */
interface ConnectionLike {
  admit(request: IncomingMessage): { peer?: unknown; rejection?: 401 | 403 }
  authorizeIndex(request: IncomingMessage, response: IndexResponse): boolean
  createPeer(options: { principal: { kind: 'owner' } }): unknown
}

/** Collaborators the gate needs. */
export interface GateOptions {
  /** Validated configuration. */
  readonly config: Config
  /** Cookie codec. */
  readonly cookie: SessionCookie
  /** Session table. */
  readonly store: SessionStore
  /** Log sink; the gate never logs credentials. */
  readonly warn: (message: string) => void
}

/** Outcome of resolving a request's session. */
type Resolution = { sessionId: string; accountId: string } | undefined

/**
 * Wrap admission so a valid session cookie is admitted as the shared operator
 * peer, and an invalid one is redirected to the login page.
 * @param connection - the connection service to wrap.
 * @param options - configuration, session state, and log sink.
 * @returns disposer restoring the original methods.
 */
export function installGate(connection: unknown, options: GateOptions): () => void {
  const target = connection as ConnectionLike
  const originalAdmit = target.admit.bind(target)
  const originalAuthorizeIndex = target.authorizeIndex.bind(target)
  const ownerPeer = target.createPeer({ principal: { kind: 'owner' } })
  const { config, cookie, store, warn } = options

  const resolve = (request: unknown): Resolution => {
    const id = cookie.read(cookieHeader(request))
    if (id === undefined) return undefined
    const record = store.get(id)
    return record === undefined ? undefined : { sessionId: record.id, accountId: record.accountId }
  }

  const isPublic = (pathname: string): boolean =>
    pathname === config.loginPath ||
    pathname === config.logoutPath ||
    pathname === config.statusPath

  target.admit = (request) => {
    const admission = originalAdmit(request)
    if (admission.peer !== undefined || admission.rejection === 403) return admission

    const resolution = resolve(request)
    if (resolution !== undefined) return { peer: ownerPeer }

    if (config.mode === 'observe') warn('observe: would deny an unauthenticated /api request')
    return admission
  }

  target.authorizeIndex = (request, response) => {
    const pathname = pathnameOf(request)
    if (isPublic(pathname)) return true

    const resolution = resolve(request)
    if (resolution !== undefined) return true

    // The launch token stays a break-glass path: exchange it, and admit a
    // browser that already holds the cookie it produced. Both checks are
    // read-only, so a failed one cannot leave a half-written response behind.
    if (hasLaunchToken(request)) return originalAuthorizeIndex(request, response)
    if (originalAdmit(request).peer !== undefined) return true

    if (config.mode === 'observe') {
      warn(`observe: would deny the page request for ${pathname}`)
      return originalAuthorizeIndex(request, response)
    }

    const next = `next=${encodeURIComponent(withSearch(request))}`
    const location = `${config.loginPath}?${next}`
    response.writeHead(303, {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    response.end()
    return false
  }

  return () => {
    target.admit = originalAdmit
    target.authorizeIndex = originalAuthorizeIndex
  }
}

/**
 * Read the `Cookie` header from either representation `dsh` passes around.
 *
 * The static frontend authorizes with a Fetch `Request` (`headers.get`), while
 * `/api` admits a node `IncomingMessage` (`headers.cookie`). Both must resolve to
 * the same session, so the cookie is read through one helper.
 * @param request - Fetch request or node request.
 * @returns the raw header value, or `undefined`.
 */
export function cookieHeader(request: unknown): string | undefined {
  const headers = (request as { headers?: unknown } | undefined)?.headers
  if (headers === undefined || headers === null) return undefined

  const getter = (headers as { get?: unknown }).get
  if (typeof getter === 'function') {
    const value = (getter as (name: string) => unknown).call(headers, 'cookie')
    return typeof value === 'string' ? value : undefined
  }

  const value = (headers as Record<string, unknown>).cookie
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join('; ')
  return undefined
}

/**
 * Whether a request carries the process launch token.
 *
 * The token query is the operator's break-glass credential; the gate must let
 * `dsh` exchange it instead of redirecting the operator to a login page they may
 * have no account for.
 * @param request - Fetch request or node request.
 * @returns whether a `token` query parameter is present.
 */
export function hasLaunchToken(request: unknown): boolean {
  const target = (request as { url?: unknown }).url
  if (typeof target !== 'string') return false
  try {
    return new URL(target, 'http://dsh.invalid').searchParams.has('token')
  } catch {
    return false
  }
}

/**
 * Read the pathname of a request without trusting malformed URLs.
 * @param request - incoming request.
 * @returns the pathname, or `/` when the URL cannot be parsed.
 */
function pathnameOf(request: unknown): string {
  try {
    const target = (request as { url?: unknown }).url
    return new URL(typeof target === 'string' ? target : '/', 'http://dsh.invalid').pathname
  } catch {
    return '/'
  }
}

/**
 * Read the path and query of a request, for the post-login redirect.
 * @param request - incoming request.
 * @returns path with query, or `/`.
 */
function withSearch(request: unknown): string {
  const target = (request as { url?: unknown }).url
  const url = typeof target === 'string' && target !== '' ? target : '/'
  return url.startsWith('/') ? url : '/'
}
