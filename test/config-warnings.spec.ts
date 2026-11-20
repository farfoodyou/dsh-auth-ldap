import { describe, expect, it } from 'vitest'

import { configWarnings, parseConfig } from '../src/config.js'

describe('configWarnings', () => {
  it('warns when no backend is enabled, without blocking the mount', () => {
    expect(configWarnings(parseConfig({ mode: 'observe' }))).toContain(
      'no credential backend is enabled; nothing can authenticate until one is configured',
    )
  })

  it('reports only the single-backend risk for a local-only deployment', () => {
    const config = parseConfig({
      local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' },
    })

    expect(configWarnings(config)).toEqual([
      'local accounts are the only backend; a lost password file locks everyone out',
    ])
  })

  it('warns that local accounts alone are a single point of failure in gate mode', () => {
    const config = parseConfig({
      mode: 'gate',
      local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' },
    })

    expect(configWarnings(config)).toContain(
      'local accounts are the only backend; a lost password file locks everyone out',
    )
  })

  it('warns when directory certificate verification is disabled', () => {
    const config = parseConfig({
      ldap: {
        enabled: true,
        url: 'ldaps://dc1.corp.example.com',
        userSearchBase: 'ou=people,dc=corp,dc=example,dc=com',
        rejectUnauthorized: false,
      },
    })

    expect(configWarnings(config)).toContain(
      'ldap.rejectUnauthorized is disabled; the directory certificate is not verified',
    )
  })
})
