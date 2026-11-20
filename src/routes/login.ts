/**
 * Login and logout endpoints.
 *
 * Both handlers are pure functions of their collaborators, so they are unit
 * tested without a running server.
 * @module dsh-auth-ldap/routes/login
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AuthenticatedUser } from '../authenticate.js'
import type { Config } from '../config.js'
import { escapeHtml, renderLoginPage } from '../login-page.js'
import type { SessionCookie, SessionStore } from '../session.js'

/** Largest accepted form body. */
const MAX_BODY_BYTES = 4096

/** Failure budget per key before a cooldown. */
const MAX_FAILURES = 5

/** Cooldown applied after the budget is spent. */
const COOLDOWN_MS = 5 * 60 * 1000

/** Login route collaborators. */
export interface LoginDeps {
  /** Validated configuration. */
  readonly config: Config
  /** Session table. */
  readonly store: SessionStore
  /** Cookie codec. */
  readonly cookie: SessionCookie
  /** Resolves submitted credentials through the configured backends. */
  readonly verify: (username: string, password: string) => Promise<AuthenticatedUser | undefined>
  /** Log sink; never receives credentials. */
  readonly warn: (message: string) => void
}

/** In-memory attempt budget keyed by account and client address. */
class AttemptBudget {
  private readonly failures = new Map<string, { count: number; resetAt: number }>()

  /**
   * @param key - account or address bucket.
   * @returns whether the bucket is cooling down.
   */
  blocked(key: string): boolean {
    const entry = this.failures.get(key)
    if (entry === undefined) return false
    if (entry.resetAt <= Date.now()) {
      this.failures.delete(key)
      return false
    }
    return entry.count >= MAX_FAILURES
  }

  /**
   * Record a failure for one bucket.
   * @param key - account or address bucket.
   */
  fail(key: string): void {
    const entry = this.failures.get(key)
    if (entry === undefined || entry.resetAt <= Date.now()) {
      this.failures.set(key, { count: 1, resetAt: Date.now() + COOLDOWN_MS })
      return
    }
    entry.count += 1
  }

  /**
   * Clear a bucket after a successful login.
   * @param key - account or address bucket.
   */
  reset(key: string): void {
    this.failures.delete(key)
  }
}

/**
 * Send a response with the headers every authentication response needs.
 * @param response - response to own.
 * @param status - status code.
 * @param headers - extra headers.
 * @param body - body text.
 */
function send(
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...headers,
  })
  response.end(body)
}

/**
 * Read a form body with a hard size cap.
 * @param request - incoming request.
 * @returns the raw body, or `undefined` when it exceeds the cap.
 */
async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Reject cross-site form posts before validating credentials.
 * @param request - incoming request.
 * @returns whether the origin is acceptable.
 */
function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Accept only same-origin absolute paths as a post-login destination.
 * @param value - submitted `next` value.
 * @returns the destination to use.
 */
export function safeNext(value: string | null): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (value.startsWith('/auth')) return '/'
  return value
}

/**
 * Create the login handler.
 *
 * `GET` renders the form; `POST` verifies the password against the local
 * account file, creates a session, and redirects into the application.
 * @param deps - configuration, session state, and account source.
 * @returns an HTTP handler owning the full response lifecycle.
 */
export function createLoginHandler(
  deps: LoginDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const budget = new AttemptBudget()
  const { config, store, cookie, verify, warn } = deps

  const render = (
    response: ServerResponse,
    authority: string,
    next: string,
    error: string,
    status = 200,
  ): void => {
    send(
      response,
      status,
      { 'content-type': 'text/html; charset=utf-8' },
      renderLoginPage({
        action: config.loginPath,
        authority,
        next,
        error,
        localEnabled: config.local.enabled,
        ldapEnabled: config.ldap.enabled,
      }),
    )
  }

  return async (request, response) => {
    const authority =
      config.publicHost === '' ? (request.headers.host ?? 'unknown host') : config.publicHost
    const url = new URL(request.url ?? '/', 'http://dsh.invalid')

    if (request.method === 'GET' || request.method === 'HEAD') {
      render(response, authority, safeNext(url.searchParams.get('next')), '')
      return
    }

    if (request.method !== 'POST') {
      send(response, 405, { allow: 'GET, HEAD, POST' }, 'method not allowed\n')
      return
    }

    if (!originAllowed(request)) {
      warn('login rejected: cross-origin form post')
      render(response, authority, '/', 'Sign-in failed.', 403)
      return
    }

    if (!config.local.enabled && !config.ldap.enabled) {
      render(response, authority, '/', 'No sign-in method is configured on this instance.', 403)
      return
    }

    const contentType = request.headers['content-type'] ?? ''
    if (!String(contentType).startsWith('application/x-www-form-urlencoded')) {
      send(response, 415, {}, 'expected a form post\n')
      return
    }

    const body = await readBody(request)
    if (body === undefined) {
      send(response, 413, {}, 'form body too large\n')
      return
    }

    const form = new URLSearchParams(body)
    const username = (form.get('username') ?? '').trim()
    const password = form.get('password') ?? ''
    const next = safeNext(form.get('next'))
    const address = request.socket.remoteAddress ?? 'unknown'
    const accountKey = username.toLowerCase()

    if (budget.blocked(accountKey) || budget.blocked(address)) {
      warn(`login throttled: ${accountKey} from ${address}`)
      render(response, authority, next, 'Too many attempts. Try again later.', 429)
      return
    }

    const account = await verify(username, password)
    if (account === undefined) {
      budget.fail(accountKey)
      budget.fail(address)
      warn(`login failed: ${accountKey} from ${address}`)
      render(response, authority, next, 'Sign-in failed.', 401)
      return
    }

    budget.reset(accountKey)
    budget.reset(address)
    const session = await store.create(
      { accountId: account.accountId, displayName: account.displayName, roles: account.roles },
      config.session.ttlSeconds,
    )
    warn(`login succeeded: ${account.accountId} (${account.backend}) from ${address}`)

    response.writeHead(303, {
      location: next,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': cookie.serialize(session),
    })
    response.end()
  }
}

/**
 * Create the logout handler.
 *
 * `GET` is accepted because the application has no way to know this route, so a
 * bookmarkable sign-out is worth the small exposure: logout only ever destroys
 * the caller's own session.
 * @param deps - session state and cookie codec.
 * @returns an HTTP handler owning the full response lifecycle.
 */
export function createLogoutHandler(deps: {
  readonly store: SessionStore
  readonly cookie: SessionCookie
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const id = deps.cookie.read(request.headers.cookie)
    if (id !== undefined) await deps.store.revoke(id)
    response.writeHead(303, {
      location: '/',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': deps.cookie.clear(),
    })
    response.end()
  }
}

/** Escape helper re-exported for templates that interpolate user input. */
export { escapeHtml }
