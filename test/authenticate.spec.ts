import { describe, expect, it } from 'vitest'

import { createCredentialChain } from '../src/authenticate.js'
import { parseConfig } from '../src/config.js'
import type { DirectoryConnection } from '../src/ldap/types.js'
import { hashPassword } from '../src/password.js'
import { type UsersFile, upsertAccount } from '../src/users.js'

async function localFile(): Promise<UsersFile> {
  return upsertAccount(
    { version: 1, accounts: [] },
    {
      id: 'alice',
      displayName: 'Alice (local)',
      roles: ['admin'],
      disabled: false,
      password: await hashPassword('local-password'),
    },
  )
}

function directorySpy(): {
  connector: () => Promise<DirectoryConnection>
  calls: () => number
} {
  let calls = 0
  return {
    calls: () => calls,
    connector: () => {
      calls += 1
      return Promise.resolve({
        bind: () => Promise.resolve(),
        search: () => Promise.resolve([]),
        unbind: () => Promise.resolve(),
      })
    },
  }
}

function chain(options: { local: boolean; ldap: boolean }) {
  const warnings: string[] = []
  const spy = directorySpy()
  const verify = createCredentialChain({
    config: parseConfig({
      local: { enabled: options.local, usersFile: '/tmp/users.json' },
      ldap: {
        enabled: options.ldap,
        url: 'ldaps://dc1.example.com',
        userSearchBase: 'ou=people,dc=example,dc=com',
      },
    }),
    readUsers: localFile,
    ...(options.ldap ? { connector: spy.connector } : {}),
    warn: (message) => warnings.push(message),
  })
  return { verify, warn: () => warnings.join(' | '), directoryCalls: spy.calls }
}

describe('createCredentialChain', () => {
  it('authenticates a local account', async () => {
    const { verify } = chain({ local: true, ldap: false })

    await expect(verify('ALICE', 'local-password')).resolves.toEqual({
      accountId: 'alice',
      displayName: 'Alice (local)',
      roles: ['admin'],
      backend: 'local',
    })
  })

  it('never consults the directory for a name that exists locally', async () => {
    const { verify, directoryCalls } = chain({ local: true, ldap: true })

    await expect(verify('alice', 'wrong-password')).resolves.toBeUndefined()
    expect(directoryCalls()).toBe(0)
  })

  it('falls through to the directory for a name absent locally', async () => {
    const { verify, directoryCalls } = chain({ local: true, ldap: true })

    await expect(verify('bob', 'whatever')).resolves.toBeUndefined()
    expect(directoryCalls()).toBe(1)
  })

  it('resolves nothing when every backend is disabled', async () => {
    const { verify, warn } = chain({ local: false, ldap: false })

    await expect(verify('alice', 'local-password')).resolves.toBeUndefined()
    expect(warn()).toBe('')
  })

  it('normalizes the submitted login name', async () => {
    const { verify } = chain({ local: true, ldap: false })

    await expect(verify('  Alice  ', 'local-password')).resolves.toMatchObject({
      accountId: 'alice',
    })
  })
})
