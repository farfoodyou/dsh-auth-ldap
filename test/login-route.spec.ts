import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'
import { hashPassword } from '../src/password.js'
import { createLoginHandler, createLogoutHandler, safeNext } from '../src/routes/login.js'
import { SessionCookie, SessionStore } from '../src/session.js'
import { type UsersFile, authenticateLocal, saveUsers, upsertAccount } from '../src/users.js'

interface Captured {
  status?: number
  headers: Record<string, string | number>
  body?: string | undefined
}

function response(captured: Captured) {
  return {
    writeHead(status: number, headers: Record<string, string | number> = {}) {
      captured.status = status
      captured.headers = headers
      return this
    },
    end(body?: string) {
      captured.body = body
    },
  }
}

function request(init: {
  method?: string
  headers?: Record<string, string>
  body?: string | undefined
}): IncomingMessage {
  const chunks = init.body === undefined ? [] : [Buffer.from(init.body)]
  const stream = {
    method: init.method ?? 'GET',
    url: '/auth/login',
    headers: init.headers ?? {},
    socket: { remoteAddress: '192.0.2.10' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  return stream as unknown as IncomingMessage
}

async function fixture(extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-'))
  const usersPath = join(directory, 'users.json')
  const file: UsersFile = upsertAccount(
    { version: 1, accounts: [] },
    {
      id: 'alice',
      displayName: 'Alice',
      roles: ['admin'],
      disabled: false,
      password: await hashPassword('valid-password'),
    },
  )
  await saveUsers(usersPath, file)

  const config = parseConfig({
    mode: 'gate',
    local: { enabled: true, usersFile: usersPath },
    ...extra,
  })
  const store = new SessionStore('')
  const cookie = new SessionCookie(randomBytes(32), 'dsh_auth_ldap', false, 3600)
  const warnings: string[] = []
  const handler = createLoginHandler({
    config,
    store,
    cookie,
    verify: async (username, password) => {
      const account = await authenticateLocal(file, username, password)
      return account === undefined
        ? undefined
        : {
            accountId: account.id.toLowerCase(),
            displayName: account.displayName,
            roles: account.roles,
            backend: 'local' as const,
          }
    },
    warn: (message) => warnings.push(message),
  })
  return { handler, store, cookie, warnings, file }
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

const formHeaders = {
  'content-type': 'application/x-www-form-urlencoded',
  host: 'dsh.lab.hu',
}

describe('createLoginHandler', () => {
  it('renders the form', async () => {
    const { handler } = await fixture()
    const captured: Captured = { headers: {} }

    await handler(request({}), response(captured) as never)

    expect(captured.status).toBe(200)
    expect(captured.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(captured.body).toContain('name="username"')
    expect(captured.body).toContain('name="password"')
    expect(captured.body).not.toContain('Alice')
  })

  it('signs a session in and redirects into the application', async () => {
    const { handler, store } = await fixture()
    const captured: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: formHeaders,
        body: form({ username: 'alice', password: 'valid-password', next: '/' }),
      }),
      response(captured) as never,
    )

    expect(captured.status).toBe(303)
    expect(captured.headers.location).toBe('/')
    expect(String(captured.headers['set-cookie'])).toContain('dsh_auth_ldap=')
    expect(store.size).toBe(1)
  })

  it('fails uniformly for a wrong password and an unknown account', async () => {
    const { handler, store } = await fixture()
    const wrong: Captured = { headers: {} }
    const unknown: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: formHeaders,
        body: form({ username: 'alice', password: 'nope' }),
      }),
      response(wrong) as never,
    )
    await handler(
      request({
        method: 'POST',
        headers: formHeaders,
        body: form({ username: 'bob', password: 'nope' }),
      }),
      response(unknown) as never,
    )

    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body).toBe(unknown.body)
    expect(store.size).toBe(0)
  })

  it('rejects a cross-origin post before verifying credentials', async () => {
    const { handler } = await fixture()
    const captured: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: { ...formHeaders, origin: 'https://evil.example' },
        body: form({ username: 'alice', password: 'valid-password' }),
      }),
      response(captured) as never,
    )

    expect(captured.status).toBe(403)
  })

  it('accepts an allowlisted origin when the posted host differs', async () => {
    const { handler, store } = await fixture({
      allowedOrigins: ['dsh.lab.hu', '192.168.8.100:3080'],
    })
    const captured: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: {
          ...formHeaders,
          host: '192.168.8.100:3080',
          origin: 'https://dsh.lab.hu',
        },
        body: form({ username: 'alice', password: 'valid-password' }),
      }),
      response(captured) as never,
    )

    expect(captured.status).toBe(303)
    expect(store.size).toBe(1)
  })

  it('still rejects an origin outside the allowlist', async () => {
    const { handler, store } = await fixture({ allowedOrigins: ['dsh.lab.hu'] })
    const captured: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: { ...formHeaders, host: '192.168.8.100:3080', origin: 'https://evil.example' },
        body: form({ username: 'alice', password: 'valid-password' }),
      }),
      response(captured) as never,
    )

    expect(captured.status).toBe(403)
    expect(store.size).toBe(0)
  })

  it('rejects a non-form content type', async () => {
    const { handler } = await fixture()
    const captured: Captured = { headers: {} }

    await handler(
      request({
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'dsh.lab.hu' },
        body: '{}',
      }),
      response(captured) as never,
    )

    expect(captured.status).toBe(415)
  })

  it('throttles after repeated failures', async () => {
    const { handler } = await fixture()
    let last: Captured = { headers: {} }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = { headers: {} }
      await handler(
        request({
          method: 'POST',
          headers: formHeaders,
          body: form({ username: 'alice', password: 'wrong' }),
        }),
        response(last) as never,
      )
    }

    expect(last.status).toBe(429)
  })
})

describe('createLogoutHandler', () => {
  it('revokes the session and clears the cookie', async () => {
    const { cookie, store } = await fixture()
    const session = await store.create({ accountId: 'alice', displayName: 'Alice', roles: [] }, 600)
    const handler = createLogoutHandler({ store, cookie })
    const captured: Captured = { headers: {} }

    await handler(
      request({ method: 'GET', headers: { cookie: `dsh_auth_ldap=${cookie.sign(session)}` } }),
      response(captured) as never,
    )

    expect(captured.status).toBe(303)
    expect(String(captured.headers['set-cookie'])).toContain('Max-Age=0')
    expect(store.size).toBe(0)
  })
})

describe('safeNext', () => {
  it('accepts only same-origin absolute paths', () => {
    expect(safeNext('/workspace')).toBe('/workspace')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext(null)).toBe('/')
    expect(safeNext('/auth/login')).toBe('/')
  })
})
