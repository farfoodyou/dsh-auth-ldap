import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hashPassword } from '../src/password.js'
import {
  type Account,
  authenticateLocal,
  emptyUsersFile,
  findAccount,
  loadUsers,
  saveUsers,
  upsertAccount,
} from '../src/users.js'

async function tempFile(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dsh-auth-ldap-')), name)
}

async function account(
  id: string,
  password = 'valid-password',
  disabled = false,
): Promise<Account> {
  return {
    id,
    displayName: id.toUpperCase(),
    roles: ['admin'],
    disabled,
    password: await hashPassword(password),
  }
}

describe('loadUsers and saveUsers', () => {
  it('returns an empty document when the file does not exist', async () => {
    await expect(loadUsers(await tempFile('users.json'))).resolves.toEqual({
      version: 1,
      accounts: [],
    })
  })

  it('round-trips accounts and writes owner-only permissions', async () => {
    const path = await tempFile('nested/users.json')
    const alice = await account('alice')

    await saveUsers(path, upsertAccount(emptyUsersFile(), alice))
    const loaded = await loadUsers(path)

    expect(loaded.accounts).toHaveLength(1)
    expect(loaded.accounts[0]?.id).toBe('alice')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).not.toContain('valid-password')
  })

  it('rejects a document with an unknown version', async () => {
    const path = await tempFile('users.json')
    await writeFile(path, JSON.stringify({ version: 2, accounts: [] }))

    await expect(loadUsers(path)).rejects.toThrow(/not a version 1 account file/u)
  })
})

describe('findAccount', () => {
  it('matches case-insensitively', async () => {
    const file = upsertAccount(emptyUsersFile(), await account('Alice'))

    expect(findAccount(file, 'ALICE')?.id).toBe('Alice')
    expect(findAccount(file, 'bob')).toBeUndefined()
  })
})

describe('authenticateLocal', () => {
  it('accepts the right password', async () => {
    const file = upsertAccount(emptyUsersFile(), await account('alice'))

    await expect(authenticateLocal(file, 'alice', 'valid-password')).resolves.toMatchObject({
      id: 'alice',
    })
  })

  it('rejects a wrong password and an unknown account identically', async () => {
    const file = upsertAccount(emptyUsersFile(), await account('alice'))

    await expect(authenticateLocal(file, 'alice', 'wrong-password')).resolves.toBeUndefined()
    await expect(authenticateLocal(file, 'nobody', 'valid-password')).resolves.toBeUndefined()
  })

  it('rejects a disabled account even with the right password', async () => {
    const file = upsertAccount(emptyUsersFile(), await account('alice', 'valid-password', true))

    await expect(authenticateLocal(file, 'alice', 'valid-password')).resolves.toBeUndefined()
  })
})

describe('upsertAccount', () => {
  it('replaces an existing account case-insensitively', async () => {
    const first = upsertAccount(emptyUsersFile(), await account('alice'))
    const replaced = upsertAccount(first, await account('ALICE', 'other-password'))

    expect(replaced.accounts).toHaveLength(1)
    expect(replaced.accounts[0]?.id).toBe('ALICE')
    await expect(authenticateLocal(replaced, 'alice', 'other-password')).resolves.toBeDefined()
  })
})
