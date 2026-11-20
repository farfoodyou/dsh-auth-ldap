/**
 * Session state and the signed cookie that points at it.
 *
 * Admission in `dsh` runs synchronously, so a session must be verifiable with a
 * signature check and a map lookup: the directory or password file is touched
 * only at login.
 * @module dsh-auth-ldap/session
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One logged-in browser session. */
export interface SessionRecord {
  /** Opaque session id; also the cookie subject. */
  readonly id: string
  /** Account that authenticated. */
  readonly accountId: string
  /** Display name captured at login. */
  readonly displayName: string
  /** Roles captured at login. */
  readonly roles: readonly string[]
  /** Creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Absolute expiry, epoch milliseconds. */
  readonly expiresAt: number
}

/** Input needed to create a session. */
export interface SessionInput {
  /** Account that authenticated. */
  readonly accountId: string
  /** Display name captured at login. */
  readonly displayName: string
  /** Roles captured at login. */
  readonly roles: readonly string[]
}

/**
 * Load the signing secret, creating it on first use.
 * @param path - path of the secret file.
 * @returns 32 random bytes.
 */
export async function loadOrCreateSecret(path: string): Promise<Buffer> {
  try {
    const existing = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64')
    if (existing.length === 32) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const secret = randomBytes(32)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${secret.toString('base64')}\n`, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
  return secret
}

/** Session table with durable storage and absolute expiry. */
export class SessionStore {
  private readonly records = new Map<string, SessionRecord>()

  /**
   * @param file - JSON file backing the table, or `''` for memory only.
   */
  constructor(private readonly file: string) {}

  /**
   * Load persisted sessions and drop expired ones.
   */
  async load(): Promise<void> {
    if (this.file === '') return
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { sessions?: SessionRecord[] }
      for (const record of parsed.sessions ?? []) {
        if (record.expiresAt > Date.now()) this.records.set(record.id, record)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /**
   * Create a session for an authenticated account.
   * @param input - authenticated account facts.
   * @param ttlSeconds - absolute lifetime.
   * @returns the new record.
   */
  async create(input: SessionInput, ttlSeconds: number): Promise<SessionRecord> {
    const now = Date.now()
    const record: SessionRecord = {
      id: randomBytes(32).toString('base64url'),
      accountId: input.accountId,
      displayName: input.displayName,
      roles: [...input.roles],
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    }
    this.records.set(record.id, record)
    await this.persist()
    return record
  }

  /**
   * Read a live session.
   * @param id - session id from a cookie.
   * @returns the record, or `undefined` when absent or expired.
   */
  get(id: string): SessionRecord | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    if (record.expiresAt <= Date.now()) {
      this.records.delete(id)
      return undefined
    }
    return record
  }

  /**
   * Revoke every session of one account, used when an account is disabled.
   * @param accountId - account whose sessions end.
   * @returns how many sessions were removed.
   */
  async revokeAccount(accountId: string): Promise<number> {
    let removed = 0
    for (const [id, record] of this.records) {
      if (record.accountId === accountId) {
        this.records.delete(id)
        removed += 1
      }
    }
    if (removed > 0) await this.persist()
    return removed
  }

  /**
   * Remove a single session.
   * @param id - session id.
   */
  async revoke(id: string): Promise<void> {
    if (this.records.delete(id)) await this.persist()
  }

  /** Number of live sessions. */
  get size(): number {
    return this.records.size
  }

  /** Persist the table, dropping expired records first. */
  private async persist(): Promise<void> {
    if (this.file === '') return
    const now = Date.now()
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id)
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.tmp`
    const body = { sessions: [...this.records.values()] }
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
    await chmod(this.file, 0o600)
  }
}

/** Cookie value: `v1.<sessionId>.<expiresAt>.<signature>`. */
export interface CookiePayload {
  /** Session id. */
  readonly id: string
  /** Absolute expiry carried by the cookie, epoch milliseconds. */
  readonly expiresAt: number
}

/** Signed session cookie codec. */
export class SessionCookie {
  private readonly key: Buffer

  /**
   * @param secret - signing secret.
   * @param name - cookie name.
   * @param secure - emit the `Secure` attribute.
   * @param ttlSeconds - lifetime used when minting a cookie.
   */
  constructor(
    secret: Buffer,
    readonly name: string,
    private readonly secure: boolean,
    private readonly ttlSeconds: number,
  ) {
    this.key = secret
  }

  /**
   * Sign one session into a cookie value.
   * @param session - live session record.
   * @returns the cookie value.
   */
  sign(session: SessionRecord): string {
    const expiresAt = Math.min(session.expiresAt, Date.now() + this.ttlSeconds * 1000)
    const payload = `v1.${session.id}.${String(expiresAt)}`
    return `${payload}.${this.mac(payload)}`
  }

  /**
   * Verify a cookie value without touching the session table.
   * @param value - raw cookie value.
   * @returns the payload, or `undefined` when malformed, forged, or expired.
   */
  verify(value: string): CookiePayload | undefined {
    const parts = value.split('.')
    if (parts.length !== 4) return undefined
    const [version, id, expires, signature] = parts
    if (version !== 'v1' || id === undefined || expires === undefined || signature === undefined) {
      return undefined
    }
    const payload = `${version}.${id}.${expires}`
    const expected = Buffer.from(this.mac(payload))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined
    const expiresAt = Number(expires)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return undefined
    return { id, expiresAt }
  }

  /**
   * Read this cookie out of a request `Cookie` header.
   * @param header - raw header value.
   * @returns the session id, or `undefined`.
   */
  read(header: string | readonly string[] | undefined): string | undefined {
    const raw = Array.isArray(header) ? header.join('; ') : header
    if (typeof raw !== 'string') return undefined
    for (const part of raw.split(';')) {
      const separator = part.indexOf('=')
      if (separator === -1) continue
      if (part.slice(0, separator).trim() !== this.name) continue
      const payload = this.verify(part.slice(separator + 1).trim())
      return payload?.id
    }
    return undefined
  }

  /**
   * Build the `Set-Cookie` value that stores a session.
   * @param session - live session record.
   * @returns the header value.
   */
  serialize(session: SessionRecord): string {
    const attributes = [
      `${this.name}=${this.sign(session)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${String(this.ttlSeconds)}`,
    ]
    if (this.secure) attributes.push('Secure')
    return attributes.join('; ')
  }

  /** Build the `Set-Cookie` value that clears the session. */
  clear(): string {
    const attributes = [`${this.name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
    if (this.secure) attributes.push('Secure')
    return attributes.join('; ')
  }

  /** HMAC of one payload, base64url encoded. */
  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url')
  }
}
