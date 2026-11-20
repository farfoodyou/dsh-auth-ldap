/**
 * Client address resolution behind a reverse proxy.
 *
 * Rate limiting needs a per-client key. Behind the proxy the socket peer is the
 * proxy itself, so a naive key throttles every user together; reading a
 * forwarded header without verifying the peer would let any client choose its
 * own bucket instead. This module implements the middle ground: the header is
 * honoured only when the direct peer is a configured trusted proxy, and the
 * rightmost non-proxy address is taken as the client.
 * @module dsh-auth-ldap/net/address
 */

/** One parsed CIDR block. */
export interface Cidr {
  /** Address family. */
  readonly family: 4 | 6
  /** Prefix length in bits. */
  readonly prefix: number
  /** Network as a 32-bit (IPv4) or 128-bit (IPv6) integer. */
  readonly network: bigint
}

/**
 * Parse one IPv4 or IPv6 CIDR block.
 * @param text - block such as `10.0.0.0/8` or `::1/128`.
 * @returns the parsed block, or `undefined` when malformed.
 */
export function parseCidr(text: string): Cidr | undefined {
  const trimmed = text.trim()
  const slash = trimmed.lastIndexOf('/')
  const address = slash === -1 ? trimmed : trimmed.slice(0, slash)
  const prefixText = slash === -1 ? undefined : trimmed.slice(slash + 1)
  const parsed = parseAddress(address)
  if (parsed === undefined) return undefined

  const bits = parsed.family === 4 ? 32 : 128
  const prefix = prefixText === undefined ? bits : Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined

  const shift = BigInt(bits - prefix)
  const network = (parsed.value >> shift) << shift
  return { family: parsed.family, prefix, network }
}

/**
 * Parse a bare address into a family and integer value.
 * @param text - IPv4 or IPv6 literal, optionally IPv4-mapped or bracketed.
 * @returns the parsed address, or `undefined`.
 */
export function parseAddress(text: string): { family: 4 | 6; value: bigint } | undefined {
  let address = text.trim()
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1)
  if (address === '') return undefined

  // IPv4-mapped IPv6 (`::ffff:192.0.2.1`) compares as IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address)
  if (mapped?.[1] !== undefined) address = mapped[1]

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) {
    const octets = address.split('.').map(Number)
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
      return undefined
    const [a = 0, b = 0, c = 0, d = 0] = octets
    return { family: 4, value: BigInt(((a << 24) | (b << 16) | (c << 8) | d) >>> 0) }
  }

  if (!/^[0-9a-f:.]+$/iu.test(address) || !address.includes(':')) return undefined
  const halves = address.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] === '' ? [] : (halves[0] ?? '').split(':')
  const right = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : []
  const missing = 8 - left.length - right.length
  if (halves.length === 2 && missing < 0) return undefined
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right]
  if (groups.length !== 8) return undefined

  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) return undefined
    value = (value << 16n) | BigInt(Number.parseInt(group, 16))
  }
  return { family: 6, value }
}

/**
 * Test one address against one CIDR block.
 * @param cidr - parsed block.
 * @param address - address literal.
 * @returns whether the address is inside the block.
 */
export function contains(cidr: Cidr, address: string): boolean {
  const parsed = parseAddress(address)
  if (parsed === undefined || parsed.family !== cidr.family) return false
  const bits = cidr.family === 4 ? 32 : 128
  const shift = BigInt(bits - cidr.prefix)
  return (parsed.value >> shift) << shift === cidr.network
}

/**
 * Test one address against a configured allowlist.
 * @param address - address literal.
 * @param cidrs - configured blocks.
 * @returns whether any block matches.
 */
export function isTrustedProxy(address: string, cidrs: readonly string[]): boolean {
  for (const text of cidrs) {
    const cidr = parseCidr(text)
    if (cidr !== undefined && contains(cidr, address)) return true
  }
  return false
}

/** Facts needed to attribute a request to a client. */
export interface ClientAddressInput {
  /** Socket peer address. */
  readonly remoteAddress?: string | undefined
  /** Raw value of the configured forwarding header. */
  readonly forwardedFor?: string | undefined
  /** Trusted proxy blocks. */
  readonly trustedProxyCidrs: readonly string[]
}

/**
 * Resolve the address a request should be bucketed by.
 *
 * Returns `undefined` when the peer is a trusted proxy but the header is absent
 * or unusable: the caller must then skip per-address limiting rather than bucket
 * every user behind the proxy together.
 * @param input - peer address, header value, and trusted blocks.
 * @returns the client address, or `undefined` when it cannot be attributed.
 */
export function resolveClientAddress(input: ClientAddressInput): string | undefined {
  const peer = input.remoteAddress ?? ''
  if (peer === '') return undefined

  if (!isTrustedProxy(peer, input.trustedProxyCidrs)) return stripPort(peer)

  const chain = (input.forwardedFor ?? '')
    .split(',')
    .map((entry) => stripPort(entry.trim()))
    .filter((entry) => entry !== '')

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]
    if (candidate === undefined) continue
    if (!isTrustedProxy(candidate, input.trustedProxyCidrs)) return candidate
  }
  return undefined
}

/**
 * Drop a `host:port` suffix while preserving IPv6 literals.
 * @param value - address or address with port.
 * @returns the bare address.
 */
function stripPort(value: string): string {
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(1, end)
  }
  const colons = value.split(':').length - 1
  if (colons === 1) return value.slice(0, value.indexOf(':'))
  return value
}
