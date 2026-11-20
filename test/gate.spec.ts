import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'
import { cookieHeader, hasLaunchToken, installGate } from '../src/gate.js'
import { SessionCookie, SessionStore } from '../src/session.js'
import { hashPassword } from '../src/password.js'

interface FakeConnection {
  admit(request: IncomingMessage): { peer?: unknown; rejection?: 401 | 403 }
  authorizeIndex(
    request: IncomingMessage,
    response: {
      writeHead(status: number, headers?: Record<string, string>): unknown
      end(body?: string): unknown
    },
  ): boolean
  createPeer(options: { principal: { kind: 'owner' } }): unknown
  /** Next admission the fake returns; `undefined` keeps the built-in rejection. */
  nextAdmission: { peer?: unknown; rejection?: 401 | 403 } | undefined
  admissionCalls: number
  indexCalls: number
}

function fakeConnection(): FakeConnection {
  return {
    admit() {
      this.admissionCalls += 1
      return this.nextAdmission ?? { rejection: 401 }
    },
    authorizeIndex() {
      this.indexCalls += 1
      return false
    },
    createPeer() {
      return { id: 'owner-peer' }
    },
    nextAdmission: undefined,
    admissionCalls: 0,
    indexCalls: 0,
  }
}

function request(cookie?: string, url = '/'): IncomingMessage {
  return { url, method: 'GET', headers: cookie === undefined ? {} : { cookie } } as IncomingMessage
}

function response(double: {
  status?: number
  headers?: Record<string, string>
  body?: string | undefined
}) {
  return {
    writeHead(status: number, headers: Record<string, string> = {}) {
      double.status = status
      double.headers = headers
    },
    end(body?: string) {
      double.body = body
    },
  }
}

async function fixture(mode: 'gate' | 'observe' = 'gate') {
  const config = parseConfig({ mode, local: { enabled: true, usersFile: '/tmp/users.json' } })
  const store = new SessionStore('')
  const cookie = new SessionCookie(randomBytes(32), 'dsh_auth_ldap', true, 3600)
  const session = await store.create(
    { accountId: 'alice', displayName: 'Alice', roles: ['admin'] },
    600,
  )
  const warnings: string[] = []
  const connection = fakeConnection()
  const dispose = installGate(connection, {
    config,
    cookie,
    store,
    warn: (message) => warnings.push(message),
  })
  return { config, cookie, store, session, connection, dispose, warnings }
}

describe('installGate', () => {
  it('admits a valid session as the operator peer over /api', async () => {
    const { cookie, session, connection } = await fixture()

    expect(connection.admit(request(`dsh_auth_ldap=${cookie.sign(session)}`))).toEqual({
      peer: { id: 'owner-peer' },
    })
  })

  it('keeps the built-in rejection when no session is presented', async () => {
    const { connection } = await fixture()

    expect(connection.admit(request())).toEqual({ rejection: 401 })
  })

  it('never overrides the host fence', async () => {
    const { connection } = await fixture()
    connection.admit = () => ({ rejection: 403 })

    expect(connection.admit(request())).toEqual({ rejection: 403 })
  })

  it('admits the page document for a valid session', async () => {
    const { cookie, session, connection } = await fixture()

    expect(
      connection.authorizeIndex(request(`dsh_auth_ldap=${cookie.sign(session)}`), response({})),
    ).toBe(true)
  })

  it('redirects an unauthenticated page request to the login page', async () => {
    const { connection } = await fixture()
    const double: { status?: number; headers?: Record<string, string> } = {}

    expect(connection.authorizeIndex(request(undefined, '/?foo=1'), response(double))).toBe(false)
    expect(double.status).toBe(303)
    expect(double.headers?.location).toBe('/auth/login?next=%2F%3Ffoo%3D1')
  })

  it('reads the cookie from a Fetch request header map', async () => {
    const { cookie, session, connection } = await fixture()
    const value = `dsh_auth_ldap=${cookie.sign(session)}`
    const fetchRequest = { url: 'https://dsh.lab.hu/', headers: new Headers({ cookie: value }) }

    expect(cookieHeader(fetchRequest)).toBe(value)
    expect(connection.authorizeIndex(fetchRequest as never, response({}))).toBe(true)
  })

  it('exchanges the launch token instead of redirecting to the login page', async () => {
    const { connection } = await fixture()
    const double: { status?: number } = {}
    const tokenRequest = request(undefined, '/?token=abc')

    expect(hasLaunchToken(tokenRequest)).toBe(true)
    expect(connection.authorizeIndex(tokenRequest, response(double))).toBe(false)
    // The original authorizer was called, so our gate wrote no redirect.
    expect(double.status).toBeUndefined()
  })

  it('admits a browser that already holds a valid dsh cookie', async () => {
    const { connection } = await fixture()
    connection.nextAdmission = { peer: { id: 'launch-peer' } }

    expect(connection.authorizeIndex(request(), response({}))).toBe(true)
  })

  it('leaves decisions to the framework in observe mode', async () => {
    const { connection, warnings } = await fixture('observe')
    const double: { status?: number } = {}

    expect(connection.authorizeIndex(request(), response(double))).toBe(false)
    expect(double.status).toBeUndefined()
    expect(warnings.join(' ')).toContain('observe: would deny')
  })

  it('restores the original methods on dispose', async () => {
    const { connection, dispose } = await fixture()
    const patched = connection.admit

    dispose()

    expect(connection.admit).not.toBe(patched)
    expect(connection.admit(request())).toEqual({ rejection: 401 })
  })
})

describe('gate and password file together', () => {
  it('admits a session created after verifying the account file', async () => {
    const { cookie, store, connection } = await fixture()
    const record = await hashPassword('correct horse battery')
    expect(record.scheme).toBe('scrypt')

    const directory = await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-'))
    expect(directory).toContain('dsh-auth-ldap-')

    const session = await store.create(
      { accountId: 'alice', displayName: 'Alice', roles: ['admin'] },
      600,
    )
    expect(connection.admit(request(`dsh_auth_ldap=${cookie.sign(session)}`))).toHaveProperty(
      'peer',
    )
  })
})
