/**
 * Caller identity contributed by this plugin.
 *
 * `PrincipalMap` is merge-extensible, so the gate can hand every admitted
 * browser session a principal of its own kind instead of reusing `owner`.
 * Principals carry no credential and are safe to persist in a session log.
 * @module dsh-auth-ldap/principal
 */

import type { Principal } from '@deepseek-ai/dsh-typert-protocol'

/** Backend that proved the credential presented at login. */
export type AuthBackend = 'local' | 'ldap'

/** Identity of one authenticated browser session. */
export interface AuthPrincipal {
  /** Discriminant registered on `PrincipalMap`. */
  readonly kind: 'dsh-auth-ldap:user'
  /** Stable login name, lowercased for local accounts. */
  readonly id: string
  /** Name shown in the UI; never used for authorization. */
  readonly displayName: string
  /** Directory or account-file groups, already mapped and sorted. */
  readonly groups: readonly string[]
  /** Backend that verified the password. */
  readonly backend: AuthBackend
}

/**
 * Register the plugin principal kind with the Typert protocol so that
 * authorization resources can refer to `{ kind: 'dsh-auth-ldap:user' }`.
 */
declare module '@deepseek-ai/dsh-typert-protocol/types' {
  interface PrincipalMap {
    'dsh-auth-ldap:user': AuthPrincipal
  }
}

/** Fields a backend supplies after a successful verification. */
export interface AuthPrincipalInput {
  /** Login name as typed, before normalization. */
  readonly id: string
  /** Display name resolved by the backend. */
  readonly displayName: string
  /** Group names resolved by the backend. */
  readonly groups: readonly string[]
  /** Backend that verified the password. */
  readonly backend: AuthBackend
}

/**
 * Build a principal from verified backend output.
 *
 * Normalization lives here so that every backend produces comparable
 * identities: the login name is lowercased, group names are trimmed, deduped
 * and sorted, and an empty display name falls back to the login name.
 * @param input - verified backend output.
 * @returns the principal recorded on the admitted peer.
 */
export function createAuthPrincipal(input: AuthPrincipalInput): AuthPrincipal {
  const id = input.id.trim().toLowerCase()
  if (id === '') throw new Error('dsh-auth-ldap: principal id must not be empty')

  const groups = [
    ...new Set(input.groups.map((group) => group.trim()).filter((group) => group !== '')),
  ].sort()
  const displayName = input.displayName.trim() === '' ? id : input.displayName.trim()

  return { kind: 'dsh-auth-ldap:user', id, displayName, groups, backend: input.backend }
}

/**
 * Test a caller identity for this plugin's principal kind.
 * @param principal - identity read from a peer, possibly `undefined` outside a call.
 * @returns whether the principal belongs to this plugin.
 */
export function isAuthPrincipal(principal: Principal | undefined): principal is AuthPrincipal {
  if (principal === undefined || principal.kind !== 'dsh-auth-ldap:user') return false
  const candidate = principal as Partial<AuthPrincipal>
  return (
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.displayName === 'string' &&
    Array.isArray(candidate.groups) &&
    (candidate.backend === 'local' || candidate.backend === 'ldap')
  )
}
