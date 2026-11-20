import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SessionCookie, SessionStore, loadOrCreateSecret } from '../src/session.js'

const secret = randomBytes(32)

async function store(): Promise<SessionStore> {
  return new SessionStore(join(await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-')), 'sessions.json'))
}

function codec(name = 'dsh_auth_ldap'): SessionCookie {
  return new SessionCookie(secret, name, true, 3600)
}

describe('SessionStore', () => {
  it('creates a session that can be read back', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: ['admin'] },
      60,
    )

    expect(sessions.get(record.id)).toMatchObject({ accountId: 'alice', roles: ['admin'] })
    expect(sessions.size).toBe(1)
  })

  it('revokes a single session', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      60,
    )

    await sessions.revoke(record.id)

    expect(sessions.get(record.id)).toBeUndefined()
  })

  it('revokes every session of one account', async () => {
    const sessions = await store()
    await sessions.create({ accountId: 'alice', displayName: 'Alice', roles: [] }, 60)
    await sessions.create({ accountId: 'alice', displayName: 'Alice', roles: [] }, 60)
    const bob = await sessions.create({ accountId: 'bob', displayName: 'Bob', roles: [] }, 60)

    await expect(sessions.revokeAccount('alice')).resolves.toBe(2)
    expect(sessions.size).toBe(1)
    expect(sessions.get(bob.id)).toBeDefined()
  })

  it('drops expired sessions on read', async () => {
    const sessions = new SessionStore('')
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      -1,
    )

    expect(sessions.get(record.id)).toBeUndefined()
  })

  it('persists sessions for the next process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-'))
    const path = join(directory, 'sessions.json')
    const first = new SessionStore(path)
    const record = await first.create(
      { accountId: 'alice', displayName: 'Alice', roles: ['admin'] },
      60,
    )

    const second = new SessionStore(path)
    await second.load()

    expect(second.get(record.id)).toMatchObject({ accountId: 'alice' })
  })
})

describe('SessionCookie', () => {
  it('signs and verifies a session', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      600,
    )
    const value = codec().sign(record)

    expect(codec().verify(value)).toMatchObject({ id: record.id })
  })

  it('reads its cookie out of a header among others', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      600,
    )
    const header = `other=1; dsh_auth_ldap=${codec().sign(record)}; another=2`

    expect(codec().read(header)).toBe(record.id)
  })

  it('rejects a forged signature, a malformed value, and an expired value', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      600,
    )
    const value = codec().sign(record)
    const [version, id, expires] = value.split('.')

    expect(codec().verify(`${version}.${id}.${expires}.forged`)).toBeUndefined()
    expect(codec().verify('nonsense')).toBeUndefined()
    expect(
      codec().verify(`v1.${id}.${String(Date.now() - 1000)}.${value.split('.')[3] ?? ''}`),
    ).toBeUndefined()
  })

  it('rejects a cookie signed with another key', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      600,
    )
    const foreign = new SessionCookie(randomBytes(32), 'dsh_auth_ldap', true, 3600)

    expect(foreign.verify(codec().sign(record))).toBeUndefined()
  })

  it('marks the cookie HttpOnly, SameSite, Secure, and path-scoped', async () => {
    const sessions = await store()
    const record = await sessions.create(
      { accountId: 'alice', displayName: 'Alice', roles: [] },
      600,
    )
    const header = codec().serialize(record)

    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Secure')
    expect(header).toContain('Path=/')
    expect(codec().clear()).toContain('Max-Age=0')
  })
})

describe('loadOrCreateSecret', () => {
  it('creates a 32-byte secret once and reuses it', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-')), 'nested/session.key')

    const first = await loadOrCreateSecret(path)
    const second = await loadOrCreateSecret(path)

    expect(first).toHaveLength(32)
    expect(second.equals(first)).toBe(true)
  })
})
