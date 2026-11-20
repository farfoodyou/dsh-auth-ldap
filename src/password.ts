/**
 * Password hashing for local accounts.
 *
 * `scrypt` from `node:crypto` keeps the plugin dependency-free and is
 * memory-hard, which is what matters for a password file that guards a shell.
 * @module dsh-auth-ldap/password
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

/** Promisified scrypt with its options overload preserved. */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

/** Work factor defaults: 32 MiB of memory per verification. */
export const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const

/** Salt length in bytes. */
const SALT_BYTES = 16

/** Derived key length in bytes. */
const KEY_BYTES = 32

/** Stored password record; the plaintext is never persisted. */
export interface PasswordRecord {
  /** Only `scrypt` is accepted. */
  readonly scheme: 'scrypt'
  /** CPU/memory cost. */
  readonly N: number
  /** Block size. */
  readonly r: number
  /** Parallelization. */
  readonly p: number
  /** Base64 salt. */
  readonly salt: string
  /** Base64 derived key. */
  readonly hash: string
}

/**
 * Derive one scrypt key.
 * @param password - plaintext password.
 * @param salt - salt bytes.
 * @param params - work factor.
 * @returns the derived key.
 */
async function derive(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  const maxmem = 256 * params.N * params.r
  return scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...params, maxmem })
}

/**
 * Hash a password for storage.
 * @param password - plaintext password.
 * @param params - work factor; defaults are safe for interactive logins.
 * @returns the record to persist in the account file.
 */
export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number } = DEFAULT_PARAMS,
): Promise<PasswordRecord> {
  if (password.length < 8) throw new Error('password must be at least 8 characters')
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, params)
  return {
    scheme: 'scrypt',
    N: params.N,
    r: params.r,
    p: params.p,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  }
}

/**
 * Verify a password against a stored record in constant time.
 * @param record - stored record.
 * @param password - submitted plaintext.
 * @returns whether the password matches.
 */
export async function verifyPassword(record: PasswordRecord, password: string): Promise<boolean> {
  if (record.scheme !== 'scrypt') return false
  const salt = Buffer.from(record.salt, 'base64')
  const expected = Buffer.from(record.hash, 'base64')
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false
  const actual = await derive(password, salt, { N: record.N, r: record.r, p: record.p })
  return timingSafeEqual(expected, actual)
}
