import { describe, expect, it } from 'vitest'

import { applyFilterTemplate, escapeDnValue, escapeFilterValue } from '../src/ldap/escape.js'

describe('escapeFilterValue', () => {
  it('escapes the RFC 4515 metacharacters', () => {
    expect(escapeFilterValue('a*b')).toBe('a\\2ab')
    expect(escapeFilterValue('(cn=x)')).toBe('\\28cn=x\\29')
    expect(escapeFilterValue('back\\slash')).toBe('back\\5cslash')
    expect(escapeFilterValue('nul\u0000byte')).toBe('nul\\00byte')
  })

  it('leaves ordinary characters alone, including non-ASCII', () => {
    expect(escapeFilterValue('alice.chen-01')).toBe('alice.chen-01')
    expect(escapeFilterValue('张伟')).toBe('张伟')
  })

  it('neutralizes a wildcard injection attempt', () => {
    expect(escapeFilterValue('*)(uid=*')).toBe('\\2a\\29\\28uid=\\2a')
  })
})

describe('escapeDnValue', () => {
  it('escapes DN separators and specials', () => {
    expect(escapeDnValue('a,b')).toBe('a\\,b')
    expect(escapeDnValue('a+b')).toBe('a\\+b')
    expect(escapeDnValue('a=b')).toBe('a\\=b')
    expect(escapeDnValue('a"b')).toBe('a\\"b')
    expect(escapeDnValue('a<b>c;d')).toBe('a\\<b\\>c\\;d')
    expect(escapeDnValue('a\\b')).toBe('a\\\\b')
  })

  it('escapes a leading hash and leading or trailing space', () => {
    expect(escapeDnValue('#svc')).toBe('\\#svc')
    expect(escapeDnValue(' svc')).toBe('\\ svc')
    expect(escapeDnValue('svc ')).toBe('svc\\ ')
    expect(escapeDnValue('a b')).toBe('a b')
  })
})

describe('applyFilterTemplate', () => {
  it('substitutes and escapes the username', () => {
    expect(applyFilterTemplate('(uid={{username}})', { username: 'alice' })).toBe('(uid=alice)')
    expect(applyFilterTemplate('(uid={{username}})', { username: 'a*)(uid=*' })).toBe(
      '(uid=a\\2a\\29\\28uid=\\2a)',
    )
  })

  it('escapes the entry DN for filter syntax (RFC 4515)', () => {
    // The DN is filter *data*: `=` and `,` are legal there but `\` and `*`
    // are not, and `\=` makes the server reject the whole filter.
    expect(
      applyFilterTemplate('(member={{dn}})', { dn: 'cn=Alice,ou=people,dc=example,dc=com' }),
    ).toBe('(member=cn=Alice,ou=people,dc=example,dc=com)')
    expect(applyFilterTemplate('(member={{dn}})', { dn: 'cn=a*b\\c' })).toBe(
      '(member=cn=a\\2ab\\5cc)',
    )
  })

  it('rejects an unknown placeholder so a configuration typo fails loudly', () => {
    expect(() => applyFilterTemplate('(uid={{user}})', { username: 'alice' })).toThrow(
      /unknown filter placeholder/u,
    )
  })

  it('leaves a placeholder alone when its value was not supplied', () => {
    expect(applyFilterTemplate('(uid={{username}})', {})).toBe('(uid={{username}})')
  })
})
