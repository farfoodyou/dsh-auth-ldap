/**
 * Credential chain: the one place that decides which backend proves a password.
 *
 * Local accounts are consulted first and win when the name exists there, so a
 * directory account cannot shadow a local operator account (and the reverse).
 * A name that is absent locally falls through to the directory.
 * @module dsh-auth-ldap/authenticate
 */

import type { Config } from './config.js'
import { verifyDirectory } from './ldap/verify.js'
import type { DirectoryConnector } from './ldap/types.js'
import { type UsersFile, authenticateLocal, findAccount } from './users.js'

/** One authenticated identity, normalized across backends. */
export interface AuthenticatedUser {
  /** Login name, lowercased. */
  readonly accountId: string
  /** Name to display. */
  readonly displayName: string
  /** Roles granted for the session. */
  readonly roles: readonly string[]
  /** Which backend proved the password. */
  readonly backend: 'local' | 'ldap'
}

/** Inputs the chain needs. */
export interface CredentialChainDeps {
  /** Validated configuration. */
  readonly config: Config
  /** Reads the local account file on every attempt. */
  readonly readUsers: () => Promise<UsersFile>
  /** Directory transport; required when the directory backend is enabled. */
  readonly connector?: DirectoryConnector
  /** Log sink; receives account names and failure classes, never passwords. */
  readonly warn: (message: string) => void
}

/**
 * Build the verification function used by the login route.
 * @param deps - configuration, account source, and directory transport.
 * @returns a function resolving submitted credentials to an identity.
 */
export function createCredentialChain(
  deps: CredentialChainDeps,
): (username: string, password: string) => Promise<AuthenticatedUser | undefined> {
  const { config, readUsers, connector, warn } = deps
  const login = usernameOrEmpty

  return async (username, password) => {
    const id = login(username)

    if (config.local.enabled) {
      const file = await readUsers()
      if (findAccount(file, id) !== undefined) {
        const account = await authenticateLocal(file, id, password)
        if (account === undefined) {
          warn(`local backend rejected ${id}`)
          return undefined
        }
        return {
          accountId: account.id.toLowerCase(),
          displayName: account.displayName,
          roles: account.roles,
          backend: 'local',
        }
      }
      if (!config.ldap.enabled) {
        warn(`no local account named ${id}`)
        return undefined
      }
    }

    if (!config.ldap.enabled) return undefined

    if (connector === undefined) {
      warn('directory backend is enabled but no transport is mounted')
      return undefined
    }

    const result = await verifyDirectory(config.ldap, connector, id, password)
    if (!result.ok) {
      warn(`directory backend rejected ${id}: ${result.failure} (${result.detail})`)
      return undefined
    }
    return {
      accountId: result.user.id,
      displayName: result.user.displayName,
      roles: result.user.roles,
      backend: 'ldap',
    }
  }
}

/**
 * Normalize a submitted login name.
 * @param value - raw form value.
 * @returns trimmed, lowercased name.
 */
function usernameOrEmpty(value: string): string {
  return value.trim().toLowerCase()
}
