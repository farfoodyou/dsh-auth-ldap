/**
 * Directory ports.
 *
 * `verifyDirectory` talks to this interface rather than to a concrete client, so
 * the search-then-bind sequence is unit tested without a directory and the
 * transport stays replaceable.
 * @module dsh-auth-ldap/ldap/types
 */

/** One directory entry as the plugin consumes it. */
export interface DirectoryEntry {
  /** Entry distinguished name. */
  readonly dn: string
  /** Requested attributes; single values are strings, multi-values arrays. */
  readonly attributes: Readonly<Record<string, string | readonly string[] | Buffer>>
}

/** Search arguments the verifier needs. */
export interface DirectorySearch {
  /** Base DN. */
  readonly base: string
  /** Assertion filter, already escaped. */
  readonly filter: string
  /** Entry cap; `2` detects ambiguity without transferring a subtree. */
  readonly sizeLimit?: number
  /** Attributes to return. */
  readonly attributes: readonly string[]
}

/** An open, bound-able directory connection. */
export interface DirectoryConnection {
  /**
   * Bind as a DN.
   * @param dn - distinguished name; `''` for anonymous.
   * @param password - password.
   */
  bind(dn: string, password: string): Promise<void>
  /**
   * Search under a base DN.
   * @param search - base, filter, and limits.
   * @returns matching entries.
   */
  search(search: DirectorySearch): Promise<readonly DirectoryEntry[]>
  /** Close the connection. */
  unbind(): Promise<void>
}

/** Opens a connection for one login attempt. */
export type DirectoryConnector = (config: {
  readonly url: string
  readonly startTls: boolean
  readonly rejectUnauthorized: boolean
  readonly caFile?: string
  readonly timeoutMs: number
}) => Promise<DirectoryConnection>

/** Why a directory login failed. */
export type DirectoryFailure = 'invalid-credentials' | 'unavailable' | 'ambiguous'

/** Outcome of one directory login attempt. */
export type DirectoryResult =
  | { readonly ok: true; readonly user: DirectoryUser }
  | { readonly ok: false; readonly failure: DirectoryFailure; readonly detail: string }

/** Identity resolved from the directory. */
export interface DirectoryUser {
  /** Login name as submitted, lowercased. */
  readonly id: string
  /** Display name from the configured attribute, falling back to the login name. */
  readonly displayName: string
  /** Group names found for the entry. */
  readonly groups: readonly string[]
  /** Roles derived from group membership. */
  readonly roles: readonly string[]
}
