/**
 * Local account file: the fallback credential source, also used as break-glass
 * access when a directory is unreachable.
 *
 * The file is JSON so that the plugin and the CLI need no parser dependency. It
 * holds scrypt records only, never plaintext.
 * @module dsh-auth-ldap/users
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { type PasswordRecord, verifyPassword } from './password.js'

/** One account entry. */
export interface Account {
  /** Login name; matched case-insensitively. */
  readonly id: string
  /** Name shown in the UI. */
  readonly displayName: string
  /** Roles granted after login. */
  readonly roles: readonly string[]
  /** Disabled accounts fail verification with the same message as a wrong password. */
  readonly disabled: boolean
  /** Stored password record. */
  readonly password: PasswordRecord
}

/** Account file document. */
export interface UsersFile {
  /** Format version; a future migration bumps it. */
  readonly version: 1
  /** Accounts, unordered. */
  readonly accounts: readonly Account[]
}

/** Empty document used when the file does not exist yet. */
export function emptyUsersFile(): UsersFile {
  return { version: 1, accounts: [] }
}

/**
 * Read the account file.
 * @param path - absolute path.
 * @returns the parsed document, or an empty one when the file is absent.
 * @throws when the file exists but is not a valid account document.
 */
export async function loadUsers(path: string): Promise<UsersFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyUsersFile()
    throw error
  }

  const parsed = JSON.parse(text) as Partial<UsersFile>
  if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
    throw new Error(`dsh-auth-ldap: ${path} is not a version 1 account file`)
  }
  return { version: 1, accounts: parsed.accounts }
}

/**
 * Write the account file atomically with owner-only permissions.
 * @param path - absolute path.
 * @param file - document to persist.
 */
export async function saveUsers(path: string, file: UsersFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

/**
 * Look up an account by login name, case-insensitively.
 * @param file - account document.
 * @param id - submitted login name.
 * @returns the account, or `undefined`.
 */
export function findAccount(file: UsersFile, id: string): Account | undefined {
  const wanted = id.trim().toLowerCase()
  return file.accounts.find((account) => account.id.toLowerCase() === wanted)
}

/**
 * Verify submitted credentials against the account file.
 *
 * A missing account, a disabled account, and a wrong password are
 * indistinguishable to the caller: they all return `undefined` so the login
 * response cannot be used to enumerate accounts.
 * @param file - account document.
 * @param id - submitted login name.
 * @param password - submitted password.
 * @returns the authenticated account, or `undefined`.
 */
export async function authenticateLocal(
  file: UsersFile,
  id: string,
  password: string,
): Promise<Account | undefined> {
  const account = findAccount(file, id)
  if (account === undefined || account.disabled) {
    // Spend comparable time so a missing account is not detectably faster.
    await verifyPassword(
      {
        scheme: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        salt: Buffer.alloc(16, 1).toString('base64'),
        hash: Buffer.alloc(32, 1).toString('base64'),
      },
      password,
    )
    return undefined
  }
  return (await verifyPassword(account.password, password)) ? account : undefined
}

/**
 * Insert or replace one account.
 * @param file - account document.
 * @param account - account to write; the id is matched case-insensitively.
 * @returns the document to persist.
 */
export function upsertAccount(file: UsersFile, account: Account): UsersFile {
  const wanted = account.id.toLowerCase()
  const accounts = file.accounts.filter((existing) => existing.id.toLowerCase() !== wanted)
  return { version: 1, accounts: [...accounts, account] }
}
