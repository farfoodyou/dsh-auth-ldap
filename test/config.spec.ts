import { describe, expect, it } from 'vitest'

import { DEFAULT_LOGIN_PATH, parseConfig, validateConfig } from '../src/config.js'

describe('Config schema', () => {
  it('applies defaults for an empty configuration', () => {
    const config = parseConfig({})

    expect(config.mode).toBe('gate')
    expect(config.loginPath).toBe(DEFAULT_LOGIN_PATH)
    expect(config.ldap.enabled).toBe(false)
    expect(config.ldap.userSearchFilter).toBe('(uid={{username}})')
    expect(config.local.enabled).toBe(false)
    expect(config.session.cookieName).toBe('dsh_auth_ldap')
    expect(config.session.ttlSeconds).toBe(43_200)
    expect(config.session.secure).toBe(true)
    expect(config.trustedProxyCidrs).toEqual([])
  })

  it('keeps defaults inside a partially configured section', () => {
    const config = parseConfig({ session: { ttlSeconds: 600 } })

    expect(config.session.ttlSeconds).toBe(600)
    expect(config.session.cookieName).toBe('dsh_auth_ldap')
    expect(config.session.secure).toBe(true)
  })

  it('rejects an unknown gate mode', () => {
    expect(() => parseConfig({ mode: 'open' })).toThrow(/expected "gate" \| "observe"/)
  })

  it('rejects a session lifetime outside the supported range', () => {
    expect(() => parseConfig({ session: { ttlSeconds: 10 } })).toThrow(/>= 60/)
  })
})

describe('validateConfig', () => {
  it('requires at least one credential backend', () => {
    expect(validateConfig(parseConfig({}))).toContain(
      'at least one backend must be enabled: local or ldap',
    )
  })

  it('accepts a complete LDAPS configuration', () => {
    const config = parseConfig({
      ldap: {
        enabled: true,
        url: 'ldaps://dc1.corp.example.com:636',
        userSearchBase: 'ou=people,dc=corp,dc=example,dc=com',
        userSearchFilter: '(sAMAccountName={{username}})',
      },
    })

    expect(validateConfig(config)).toEqual([])
  })

  it('accepts a complete local configuration', () => {
    const config = parseConfig({ local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' } })

    expect(validateConfig(config)).toEqual([])
  })

  it('rejects cleartext LDAP without STARTTLS', () => {
    const config = parseConfig({
      ldap: {
        enabled: true,
        url: 'ldap://dc1.corp.example.com:389',
        userSearchBase: 'ou=people,dc=corp,dc=example,dc=com',
      },
    })

    expect(validateConfig(config)).toContain(
      'plain ldap:// without startTls sends credentials in clear text',
    )
  })

  it('rejects a user filter without the username placeholder', () => {
    const config = parseConfig({
      ldap: {
        enabled: true,
        url: 'ldaps://dc1.corp.example.com',
        userSearchBase: 'ou=people,dc=corp,dc=example,dc=com',
        userSearchFilter: '(uid=alice)',
      },
    })

    expect(validateConfig(config)).toContain(
      'ldap.userSearchFilter must contain the {{username}} placeholder',
    )
  })

  it('rejects a service account without a password variable', () => {
    const config = parseConfig({
      ldap: {
        enabled: true,
        url: 'ldaps://dc1.corp.example.com',
        userSearchBase: 'ou=people,dc=corp,dc=example,dc=com',
        bindDn: 'uid=svc,ou=people,dc=corp,dc=example,dc=com',
      },
    })

    expect(validateConfig(config)).toContain(
      'ldap.bindPasswordEnv must name the service account password variable',
    )
  })

  it('rejects a non-CIDR proxy allowlist entry', () => {
    const config = parseConfig({
      local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' },
      trustedProxyCidrs: ['10.0.0.1'],
    })

    expect(validateConfig(config)).toContain(
      'trustedProxyCidrs entry is not a CIDR block: 10.0.0.1',
    )
  })

  it('rejects a route path with a trailing slash', () => {
    const config = parseConfig({
      local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' },
      loginPath: '/auth/login/',
    })

    expect(validateConfig(config)).toContain(
      'loginPath must be an absolute path without a trailing slash',
    )
  })
})
