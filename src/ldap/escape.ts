/**
 * Directory filter and DN escaping (RFC 4515 / RFC 4514).
 *
 * A login name is attacker-controlled text. It reaches the directory only
 * through these functions, so `*`, `(`, `)`, `\`, and NUL cannot widen a filter.
 * @module dsh-auth-ldap/ldap/escape
 */

/** Characters that must be escaped inside an LDAP filter value (RFC 4515 §3). */
const FILTER_ESCAPES = new Map<string, string>([
  ['\\', '\\5c'],
  ['*', '\\2a'],
  ['(', '\\28'],
  [')', '\\29'],
  ['\u0000', '\\00'],
])

/**
 * Escape a value for use inside an LDAP assertion filter.
 * @param value - untrusted value.
 * @returns the escaped value.
 */
export function escapeFilterValue(value: string): string {
  let escaped = ''
  for (const character of value) {
    escaped += FILTER_ESCAPES.get(character) ?? character
  }
  return escaped
}

/**
 * Escape a value for use inside a distinguished name (RFC 4514 §2.4).
 * @param value - untrusted value.
 * @returns the escaped value.
 */
export function escapeDnValue(value: string): string {
  const special = new Set([',', '+', '"', '\\', '<', '>', ';', '='])
  let escaped = ''
  for (const [index, character] of [...value].entries()) {
    if (character === '\u0000') {
      escaped += '\\00'
    } else if (special.has(character)) {
      escaped += `\\${character}`
    } else if (character === ' ' && (index === 0 || index === [...value].length - 1)) {
      escaped += '\\ '
    } else if (character === '#' && index === 0) {
      escaped += '\\#'
    } else {
      escaped += character
    }
  }
  return escaped
}

/** Placeholders a filter template may contain. */
export type FilterVariable = 'username' | 'dn'

/**
 * Substitute placeholders in a configured filter template.
 *
 * Only the two documented placeholders are replaced; an unknown placeholder is
 * rejected so a typo in configuration fails at login instead of silently
 * matching every account.
 * @param template - configured filter, for example `(uid={{username}})`.
 * @param values - raw, unescaped values.
 * @returns the filter with escaped values substituted.
 * @throws when the template contains an unknown placeholder.
 */
export function applyFilterTemplate(
  template: string,
  values: Partial<Record<FilterVariable, string>>,
): string {
  const substituted = template.replaceAll(/\{\{(\w+)\}\}/gu, (_match, name: string) => {
    if (name !== 'username' && name !== 'dn') {
      throw new Error(`unknown filter placeholder: {{${name}}}`)
    }
    const value = values[name]
    if (value === undefined) return _match
    return name === 'username' ? escapeFilterValue(value) : escapeDnValue(value)
  })
  return substituted
}
