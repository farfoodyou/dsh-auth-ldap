import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'
import { applyFilterTemplate, escapeFilterValue } from '../src/ldap/escape.js'
import type {
  DirectoryConnection,
  DirectoryConnector,
  DirectoryEntry,
  DirectorySearch,
} from '../src/ldap/types.js'
import { rolesFor, verifyDirectory } from '../src/ldap/verify.js'

/** Directory entry helper. */
function entry(dn: string, attributes: Record<string, string> = {}): DirectoryEntry {
  return { dn, attributes }
}

/** Recorded call on the fake connection. */
interface Recorded {
  binds: { dn: string; password: string }[]
  searches: DirectorySearch[]
}

/**
 * Build a connector that replays scripted results and records calls.
 * @param script - per-call behaviour for bind and search.
 * @returns connector plus the call log.
 */
function fakeConnector(script: {
  bind?: (dn: string, password: string) => void
  search?: (search: DirectorySearch) => readonly DirectoryEntry[]
}): { connector: DirectoryConnector; log: Recorded } {
  const log: Recorded = { binds: [], searches: [] }
  const connection: DirectoryConnection = {
    async bind(dn, password) {
      log.binds.push({ dn, password })
      script.bind?.(dn, password)
    },
    async search(search) {
      log.searches.push(search)
      return script.search?.(search) ?? []
    },
    async unbind() {
      // no-op
    },
  }
  return { connector: async () => connection, log }
}

/** Directory configuration pointing at a fictional server. */
function config(overrides: Record<string, unknown> = {}) {
  return parseConfig({
    ldap: {
      enabled: true,
      url: 'ldaps://ldap.example.test:636',
      userSearchBase: 'ou=people,dc=example,dc=test',
      userSearchFilter: '(uid={{username}})',
      bindDn: 'cn=svc,dc=example,dc=test',
      bindPasswordEnv: 'TEST_DIRECTORY_PASSWORD',
      displayNameAttribute: 'cn',
      groupSearchBase: 'ou=groups,dc=example,dc=test',
      groupSearchFilter: '(member={{dn}})',
      groupNameAttribute: 'cn',
      adminGroups: ['dsh-admins'],
      ...overrides,
    },
  }).ldap
}

/** LDAP "invalid credentials" error, as `ldapts` shapes it. */
function invalidCredentials(): Error {
  return Object.assign(new Error('Invalid credentials'), { code: 49 })
}

describe('escapeFilterValue', () => {
  it('escapes the characters RFC 4515 reserves', () => {
    expect(escapeFilterValue('a*b(c)d\\e\u0000f')).toBe('a\\2ab\\28c\\29d\\5ce\\00f')
  })

  it('replaces the placeholders used by the filter templates', () => {
    expect(applyFilterTemplate('(uid={{username}})', { username: 'a*b' })).toBe('(uid=a\\2ab)')
    // DN placeholders are escaped for DN syntax, not filter syntax.
    expect(applyFilterTemplate('(member={{dn}})', { dn: 'cn=x,dc=y' })).toBe(
      '(member=cn\\=x\\,dc\\=y)',
    )
  })
})

describe('rolesFor', () => {
  it('grants admin when a configured group name matches', () => {
    expect(rolesFor(['dsh-admins', 'dsh-users'], [], ['dsh-admins'])).toEqual(['admin'])
  })

  it('grants admin when only the group DN matches', () => {
    expect(rolesFor([], ['cn=dsh-admins,ou=groups,dc=example,dc=test'], ['dsh-admins'])).toEqual([
      'admin',
    ])
  })

  it('falls back to viewer', () => {
    expect(rolesFor(['dsh-users'], [], ['dsh-admins'])).toEqual(['viewer'])
  })
})

describe('verifyDirectory', () => {
  it('proves the password with a second bind and maps groups to roles', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector, log } = fakeConnector({
      search: (search) =>
        search.base.startsWith('ou=groups')
          ? [entry('cn=dsh-admins,ou=groups,dc=example,dc=test', { cn: 'dsh-admins' })]
          : [entry('uid=alice,ou=people,dc=example,dc=test', { cn: 'Alice Chen' })],
    })

    const result = await verifyDirectory(config(), connector, ' Alice ', 'user-secret')

    expect(result).toMatchObject({
      ok: true,
      user: {
        id: 'alice',
        displayName: 'Alice Chen',
        groups: ['dsh-admins'],
        roles: ['admin'],
      },
    })
    expect(log.binds).toEqual([
      { dn: 'cn=svc,dc=example,dc=test', password: 'service-secret' },
      { dn: 'uid=alice,ou=people,dc=example,dc=test', password: 'user-secret' },
      { dn: 'cn=svc,dc=example,dc=test', password: 'service-secret' },
    ])
    expect(log.searches[0]?.sizeLimit).toBe(2)
  })

  it('rejects an ambiguous login without binding as the user', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector, log } = fakeConnector({
      search: () => [
        entry('uid=alice,ou=people,dc=example,dc=test'),
        entry('uid=alice,ou=other,dc=example,dc=test'),
      ],
    })

    const result = await verifyDirectory(config(), connector, 'alice', 'secret')

    expect(result).toMatchObject({ ok: false, failure: 'ambiguous' })
    expect(log.binds).toHaveLength(1)
  })

  it('returns invalid-credentials when no entry matches', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector } = fakeConnector({ search: () => [] })

    const result = await verifyDirectory(config(), connector, 'nobody', 'secret')

    expect(result).toMatchObject({ ok: false, failure: 'invalid-credentials' })
  })

  it('returns invalid-credentials when the user bind is rejected', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector } = fakeConnector({
      search: () => [entry('uid=alice,ou=people,dc=example,dc=test')],
      bind: (dn) => {
        if (dn.startsWith('uid=alice')) throw invalidCredentials()
      },
    })

    const result = await verifyDirectory(config(), connector, 'alice', 'wrong')

    expect(result).toMatchObject({ ok: false, failure: 'invalid-credentials' })
  })

  it('fails closed when the directory is unavailable', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector } = fakeConnector({
      bind: () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      },
    })

    const result = await verifyDirectory(config(), connector, 'alice', 'secret')

    expect(result).toMatchObject({ ok: false, failure: 'unavailable' })
  })

  it('fails closed when the service password variable is empty', async () => {
    delete process.env.TEST_DIRECTORY_PASSWORD
    const { connector } = fakeConnector({})

    const result = await verifyDirectory(config(), connector, 'alice', 'secret')

    expect(result).toMatchObject({ ok: false, failure: 'unavailable' })
  })

  it('rejects empty submissions without touching the directory', async () => {
    const { connector, log } = fakeConnector({})

    const result = await verifyDirectory(config(), connector, 'alice', '')

    expect(result).toMatchObject({ ok: false, failure: 'invalid-credentials' })
    expect(log.searches).toHaveLength(0)
  })

  it('escapes the login name before it reaches the filter', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector, log } = fakeConnector({
      search: () => [entry('uid=x,ou=people,dc=example,dc=test', { cn: 'X' })],
    })

    await verifyDirectory(config({ userSearchFilter: '(uid={{username}})' }), connector, 'a*', 'pw')

    expect(log.searches[0]?.filter).toBe('(uid=a\\2a)')
  })

  it('returns viewer when group mapping is disabled', async () => {
    process.env.TEST_DIRECTORY_PASSWORD = 'service-secret'
    const { connector, log } = fakeConnector({
      search: () => [entry('uid=bob,ou=people,dc=example,dc=test', { cn: 'Bob' })],
    })

    const result = await verifyDirectory(
      config({ groupSearchBase: '', groupSearchFilter: '' }),
      connector,
      'bob',
      'pw',
    )

    expect(result).toMatchObject({ ok: true, user: { roles: ['viewer'], groups: [] } })
    expect(log.searches).toHaveLength(1)
  })
})
