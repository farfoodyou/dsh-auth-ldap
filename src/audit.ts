/**
 * Append-only audit log.
 *
 * The harness logger only emits through registered exporters and, when plugins
 * run off the main thread, a plugin's stderr may not reach the service journal
 * either. Login decisions therefore also go to a file under the plugin's storage
 * directory, which the operator can always read.
 *
 * Lines carry no credential material: account names, client addresses, backend,
 * and a failure class only.
 * @module dsh-auth-ldap/audit
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Events the audit log records. */
export type AuditEvent =
  'login-ok' | 'login-fail' | 'login-throttled' | 'denied' | 'mount' | 'config-warning'

/** One recorded step. */
export interface AuditEntry {
  /** Event class. */
  readonly event: AuditEvent
  /** Additional fields; values are strings. */
  readonly fields?: Readonly<Record<string, string>>
}

/** File-backed audit sink. */
export class AuditLog {
  /**
   * @param file - absolute path; an empty string disables file logging.
   */
  constructor(private readonly file: string) {}

  /**
   * Append one entry.
   *
   * Failures are swallowed: an unwritable audit file must not deny a login.
   * @param entry - event and fields to record.
   */
  append(entry: AuditEntry): void {
    if (this.file === '') return
    const fields = Object.entries(entry.fields ?? {})
      .map(([key, value]) => `${key}=${value.replaceAll(/\s/gu, '_')}`)
      .join(' ')
    const line = `${new Date().toISOString()} ${entry.event}${fields === '' ? '' : ` ${fields}`}\n`
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      appendFileSync(this.file, line, { mode: 0o600 })
    } catch {
      // Denying access because logging failed would be worse than losing a line.
    }
  }
}
