/**
 * `search-then-bind`: the sequence that works across OpenLDAP, LLDAP, 389 DS,
 * and Active Directory without vendor-specific code.
 *
 * 1. Bind a service account (or anonymously) to search.
 * 2. Find exactly one entry for the login name.
 * 3. Bind as that entry with the submitted password; success proves it.
 * 4. Search the entry's groups and map them to roles.
 *
 * @module dsh-auth-ldap/ldap/verify
 */

import type { LdapBackendConfig } from '../config.js'
import { applyFilterTemplate } from './escape.js'
import type { DirectoryConnector, DirectoryEntry, DirectoryResult, DirectoryUser } from './types.js'

/** Attribute read for the display name when the configured one is empty. */
const FALLBACK_DISPLAY_ATTRIBUTES = ['displayName', 'cn', 'uid']

/**
 * Read one attribute value as a string.
 * @param entry - directory entry.
 * @param names - candidate attribute names, in priority order.
 * @returns the first non-empty value, or `''`.
 */
function firstValue(entry: DirectoryEntry, names: readonly string[]): string {
  for (const name of names) {
    const value = entry.attributes[name] ?? entry.attributes[name.toLowerCase()]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Buffer.isBuffer(value) && value.length > 0) return value.toString('utf8').trim()
    if (Array.isArray(value)) {
      const values = value as readonly unknown[]
      const first = values.find((item) => typeof item === 'string' && item.trim() !== '')
      if (typeof first === 'string') return first.trim()
    }
  }
  return ''
}

/**
 * Compare a group entry to one configured admin group.
 *
 * A directory may report either the group's common name or its full DN, so both
 * sides are compared case-insensitively against both forms.
 * @param candidateNames - names resolved for the group.
 * @param candidateDn - the group entry DN.
 * @param configured - admin group as written in configuration.
 * @returns whether the group matches.
 */
function matchesGroup(
  candidateNames: readonly string[],
  candidateDn: string,
  configured: string,
): boolean {
  const wanted = configured.trim().toLowerCase()
  if (wanted === '') return false

  const dn = candidateDn.trim().toLowerCase()
  if (dn !== '' && dn === wanted) return true

  // A configured admin group is usually a bare common name, while a directory
  // entry reports a full DN. Compare the first RDN value as well so both forms
  // work without asking the directory team to use one specific notation.
  const firstRdn = dn.split(',')[0] ?? ''
  const separator = firstRdn.indexOf('=')
  if (separator !== -1 && firstRdn.slice(separator + 1).trim() === wanted) return true

  return candidateNames.some((name) => name.toLowerCase() === wanted)
}

/**
 * Derive roles from group membership.
 * @param groups - group names resolved for the entry.
 * @param groupDns - group DNs resolved for the entry.
 * @param adminGroups - configured admin groups.
 * @returns the roles to grant.
 */
export function rolesFor(
  groups: readonly string[],
  groupDns: readonly string[],
  adminGroups: readonly string[],
): string[] {
  const isAdmin = adminGroups.some(
    (configured) =>
      groups.some((group) => matchesGroup([group], '', configured)) ||
      groupDns.some((dn) => matchesGroup([], dn, configured)),
  )
  return isAdmin ? ['admin'] : ['viewer']
}

/**
 * Classify a thrown directory error.
 * @param error - thrown value.
 * @returns the failure class to report.
 */
function classify(error: unknown): {
  failure: 'invalid-credentials' | 'unavailable'
  detail: string
} {
  const code = (error as { code?: unknown }).code
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  // LDAP result code 49 is invalidCredentials; anything else (timeout, socket
  // error, unwillingToPerform) is an availability problem and fails closed.
  if (code === 49 || name === 'InvalidCredentialsError') {
    return { failure: 'invalid-credentials', detail: 'bind rejected' }
  }
  return { failure: 'unavailable', detail: `${name}: ${message}` }
}

/**
 * Execute one `search-then-bind` login.
 * @param config - directory configuration.
 * @param connector - transport factory.
 * @param username - submitted login name.
 * @param password - submitted password.
 * @returns the resolved identity, or a classified failure.
 */
export async function verifyDirectory(
  config: LdapBackendConfig,
  connector: DirectoryConnector,
  username: string,
  password: string,
): Promise<DirectoryResult> {
  const login = username.trim()
  if (login === '' || password === '') {
    return { ok: false, failure: 'invalid-credentials', detail: 'empty credential' }
  }

  const servicePassword =
    config.bindPasswordEnv === '' ? '' : (process.env[config.bindPasswordEnv] ?? '')
  if (config.bindDn !== '' && servicePassword === '') {
    return {
      ok: false,
      failure: 'unavailable',
      detail: `service account password variable ${config.bindPasswordEnv} is empty`,
    }
  }

  let connection
  try {
    connection = await connector({
      url: config.url,
      startTls: config.startTls,
      rejectUnauthorized: config.rejectUnauthorized,
      caFile: config.caFile,
      timeoutMs: config.timeoutMs,
    })
  } catch (error) {
    const { detail } = classify(error)
    return { ok: false, failure: 'unavailable', detail: `connect failed: ${detail}` }
  }

  try {
    try {
      await connection.bind(config.bindDn, servicePassword)
    } catch (error) {
      const { detail } = classify(error)
      return { ok: false, failure: 'unavailable', detail: `service bind failed: ${detail}` }
    }

    let entries: readonly DirectoryEntry[]
    try {
      entries = await connection.search({
        base: config.userSearchBase,
        filter: applyFilterTemplate(config.userSearchFilter, { username: login }),
        sizeLimit: 2,
        attributes: [config.displayNameAttribute, 'cn', 'uid', 'displayName'],
      })
    } catch (error) {
      const { detail } = classify(error)
      return { ok: false, failure: 'unavailable', detail: `user search failed: ${detail}` }
    }

    if (entries.length === 0) {
      return { ok: false, failure: 'invalid-credentials', detail: 'no matching entry' }
    }
    if (entries.length > 1) {
      return {
        ok: false,
        failure: 'ambiguous',
        detail: `${String(entries.length)} entries matched`,
      }
    }

    const entry = entries[0]
    if (entry === undefined) {
      return { ok: false, failure: 'invalid-credentials', detail: 'no matching entry' }
    }

    try {
      await connection.bind(entry.dn, password)
    } catch (error) {
      const { detail } = classify(error)
      return {
        ok: false,
        failure: detail === 'bind rejected' ? 'invalid-credentials' : 'unavailable',
        detail: `user bind failed: ${detail}`,
      }
    }

    const groups: string[] = []
    const groupDns: string[] = []
    if (config.groupSearchBase !== '' && config.groupSearchFilter !== '') {
      try {
        // Re-bind the service account: a user entry often cannot read the group tree.
        if (config.bindDn !== '') await connection.bind(config.bindDn, servicePassword)
        const groupEntries = await connection.search({
          base: config.groupSearchBase,
          filter: applyFilterTemplate(config.groupSearchFilter, { dn: entry.dn }),
          attributes: [config.groupNameAttribute, 'cn'],
        })
        for (const groupEntry of groupEntries) {
          groupDns.push(groupEntry.dn)
          const name = firstValue(groupEntry, [config.groupNameAttribute, 'cn'])
          if (name !== '') groups.push(name)
        }
      } catch (error) {
        const { detail } = classify(error)
        return { ok: false, failure: 'unavailable', detail: `group search failed: ${detail}` }
      }
    }

    const displayName =
      firstValue(entry, [config.displayNameAttribute, ...FALLBACK_DISPLAY_ATTRIBUTES]) || login
    const user: DirectoryUser = {
      id: login.toLowerCase(),
      displayName,
      groups,
      roles: rolesFor(groups, groupDns, config.adminGroups),
    }
    return { ok: true, user }
  } finally {
    await connection.unbind().catch(() => undefined)
  }
}
