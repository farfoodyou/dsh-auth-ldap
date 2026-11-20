import { describe, expect, it } from 'vitest'

import { createAuthPrincipal, isAuthPrincipal } from '../src/principal.js'

describe('createAuthPrincipal', () => {
  it('normalizes the login name and sorts deduped groups', () => {
    const principal = createAuthPrincipal({
      id: '  Alice.Chen ',
      displayName: ' Alice Chen ',
      groups: ['dsh-users', ' dsh-admins ', 'dsh-users', ''],
      backend: 'ldap',
    })

    expect(principal).toEqual({
      kind: 'dsh-auth-ldap:user',
      id: 'alice.chen',
      displayName: 'Alice Chen',
      groups: ['dsh-admins', 'dsh-users'],
      backend: 'ldap',
    })
  })

  it('falls back to the login name when no display name is resolved', () => {
    const principal = createAuthPrincipal({
      id: 'bob',
      displayName: '   ',
      groups: [],
      backend: 'local',
    })

    expect(principal.displayName).toBe('bob')
  })

  it('rejects an empty login name', () => {
    expect(() =>
      createAuthPrincipal({ id: '  ', displayName: '', groups: [], backend: 'local' }),
    ).toThrow(/principal id must not be empty/)
  })

  it('carries no credential material', () => {
    const principal = createAuthPrincipal({
      id: 'carol',
      displayName: 'Carol',
      groups: ['dsh-users'],
      backend: 'ldap',
    })

    expect(Object.keys(principal).sort()).toEqual([
      'backend',
      'displayName',
      'groups',
      'id',
      'kind',
    ])
  })
})

describe('isAuthPrincipal', () => {
  it('accepts a principal produced by this plugin', () => {
    expect(
      isAuthPrincipal(
        createAuthPrincipal({ id: 'dave', displayName: '', groups: [], backend: 'local' }),
      ),
    ).toBe(true)
  })

  it('rejects the owner principal and undefined', () => {
    expect(isAuthPrincipal({ kind: 'owner' })).toBe(false)
    expect(isAuthPrincipal(undefined)).toBe(false)
  })

  it('rejects a malformed principal of the same kind', () => {
    expect(isAuthPrincipal({ kind: 'dsh-auth-ldap:user' } as never)).toBe(false)
  })
})
