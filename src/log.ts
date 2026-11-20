/**
 * Plugin diagnostics that always reach the operator.
 *
 * The harness logger only emits through registered exporters, so a plugin
 * warning can disappear into a void depending on the composing profile. Login
 * decisions are exactly what an operator needs while wiring a directory, so
 * they are written to stderr as well; the service manager captures that.
 * @module dsh-auth-ldap/log
 */

/** Prefix on every line, so a journal search finds the plugin. */
export const LOG_PREFIX = '[dsh-auth-ldap]'

/**
 * Write one diagnostic line to stderr.
 *
 * Never pass credentials: callers log account names, addresses, and failure
 * classes only.
 * @param message - line to write.
 */
export function writeDiagnostic(message: string): void {
  process.stderr.write(`${LOG_PREFIX} ${message}\n`)
}

/**
 * Build the log sink used across the plugin.
 * @param harnessWarn - harness logger sink, so both channels receive the line.
 * @returns a sink that writes to stderr and forwards to the harness logger.
 */
export function createLog(harnessWarn: (message: string) => void): (message: string) => void {
  return (message) => {
    harnessWarn(message)
    writeDiagnostic(message)
  }
}
