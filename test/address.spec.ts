import { describe, expect, it } from 'vitest'

import {
  contains,
  isTrustedProxy,
  parseAddress,
  parseCidr,
  resolveClientAddress,
} from '../src/net/address.js'

describe('parseCidr', () => {
  it('parses IPv4 blocks', () => {
    const cidr = parseCidr('192.168.8.0/24')

    expect(cidr).toMatchObject({ family: 4, prefix: 24 })
    expect(cidr?.network).toBe(0xc0a80800n)
  })

  it('parses IPv6 blocks and host prefixes', () => {
    expect(parseCidr('::1/128')).toMatchObject({ family: 6, prefix: 128 })
    expect(parseCidr('10.0.0.5')).toMatchObject({ family: 4, prefix: 32 })
  })

  it('rejects malformed blocks', () => {
    expect(parseCidr('10.0.0.0/33')).toBeUndefined()
    expect(parseCidr('10.0.0.400/8')).toBeUndefined()
    expect(parseCidr('not-an-address/8')).toBeUndefined()
    expect(parseCidr('10.0.0.0/-1')).toBeUndefined()
  })
})

describe('contains', () => {
  it('matches addresses inside a block and misses addresses outside', () => {
    const cidr = parseCidr('192.168.8.0/24')
    expect(cidr).toBeDefined()
    if (cidr === undefined) return

    expect(contains(cidr, '192.168.8.200')).toBe(true)
    expect(contains(cidr, '192.168.9.1')).toBe(false)
  })

  it('treats an IPv4-mapped IPv6 address as IPv4', () => {
    const cidr = parseCidr('127.0.0.0/8')
    if (cidr === undefined) return

    expect(contains(cidr, '::ffff:127.0.0.1')).toBe(true)
  })

  it('never matches across families', () => {
    const cidr = parseCidr('::1/128')
    if (cidr === undefined) return

    expect(contains(cidr, '192.168.8.1')).toBe(false)
  })
})

describe('parseAddress', () => {
  it('strips brackets and rejects nonsense', () => {
    expect(parseAddress('[::1]')).toMatchObject({ family: 6 })
    expect(parseAddress('10.0.0.1')).toMatchObject({ family: 4 })
    expect(parseAddress('')).toBeUndefined()
    expect(parseAddress('hello')).toBeUndefined()
    expect(parseAddress('1:2:3:4:5:6:7:8:9')).toBeUndefined()
  })
})

describe('isTrustedProxy', () => {
  it('matches any configured block', () => {
    expect(isTrustedProxy('192.168.8.200', ['192.168.8.0/24'])).toBe(true)
    expect(isTrustedProxy('10.1.2.3', ['192.168.8.0/24', '10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxy('203.0.113.9', ['192.168.8.0/24'])).toBe(false)
  })
})

describe('resolveClientAddress', () => {
  const trustedProxyCidrs = ['192.168.8.200/32', '192.168.8.0/24']

  it('uses the socket peer for a direct connection', () => {
    expect(resolveClientAddress({ remoteAddress: '203.0.113.7', trustedProxyCidrs })).toBe(
      '203.0.113.7',
    )
  })

  it('ignores a forwarded header from an untrusted peer', () => {
    expect(
      resolveClientAddress({
        remoteAddress: '203.0.113.7',
        forwardedFor: '10.9.9.9',
        trustedProxyCidrs,
      }),
    ).toBe('203.0.113.7')
  })

  it('takes the rightmost non-proxy hop behind a trusted proxy', () => {
    expect(
      resolveClientAddress({
        remoteAddress: '192.168.8.200',
        forwardedFor: '203.0.113.7, 192.168.8.10',
        trustedProxyCidrs: ['192.168.8.200/32'],
      }),
    ).toBe('192.168.8.10')
  })

  it('skips every hop when the whole chain is trusted', () => {
    expect(
      resolveClientAddress({
        remoteAddress: '192.168.8.200',
        forwardedFor: '203.0.113.7, 192.168.8.10',
        trustedProxyCidrs,
      }),
    ).toBe('203.0.113.7')
  })

  it('skips hops that are themselves trusted proxies', () => {
    expect(
      resolveClientAddress({
        remoteAddress: '192.168.8.200',
        forwardedFor: '198.51.100.4, 192.168.8.201',
        trustedProxyCidrs: ['192.168.8.0/24'],
      }),
    ).toBe('198.51.100.4')
  })

  it('cannot attribute a client when a trusted proxy sends no usable header', () => {
    expect(
      resolveClientAddress({ remoteAddress: '192.168.8.200', trustedProxyCidrs }),
    ).toBeUndefined()
    expect(
      resolveClientAddress({
        remoteAddress: '192.168.8.200',
        forwardedFor: ' , ',
        trustedProxyCidrs,
      }),
    ).toBeUndefined()
  })

  it('drops a port suffix', () => {
    expect(
      resolveClientAddress({
        remoteAddress: '192.168.8.200',
        forwardedFor: '203.0.113.7:51234',
        trustedProxyCidrs,
      }),
    ).toBe('203.0.113.7')
  })
})
