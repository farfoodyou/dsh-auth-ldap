import { readFileSync } from 'node:fs'

import { Client } from 'ldapts'

import type {
  DirectoryConnection,
  DirectoryConnector,
  DirectoryEntry,
  DirectorySearch,
} from './types.js'

/** Attribute bag as `ldapts` returns it: `dn` plus one entry per attribute. */
type RawEntry = { dn: string } & Record<string, string | string[] | Buffer | undefined>

/**
 * Drop the `dn` key and keep only attribute values the verifier understands.
 * @param entry - entry returned by `ldapts`.
 * @returns plugin-shaped entry.
 */
function normalize(entry: RawEntry): DirectoryEntry {
  const attributes: Record<string, string | readonly string[] | Buffer> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'dn' || value === undefined) continue
    attributes[key] = value
  }
  return { dn: entry.dn, attributes }
}

/**
 * Build the TLS options shared by LDAPS and STARTTLS.
 *
 * `ldapts` falls back to the hostname `localhost` when it upgrades a plain
 * connection with STARTTLS, which fails against any certificate that does not
 * cover `localhost`. The configured URL host is passed explicitly so the
 * certificate is checked against the name the operator wrote.
 * @param config - URL, TLS policy, and optional CA file.
 * @returns options for the socket and for the STARTTLS upgrade.
 */
export function tlsOptionsFor(config: {
  readonly url: string
  readonly rejectUnauthorized: boolean
  readonly caFile?: string
}): {
  rejectUnauthorized: boolean
  servername: string
  ca?: Buffer[]
} {
  const host = new URL(config.url).hostname
  const options: { rejectUnauthorized: boolean; servername: string; ca?: Buffer[] } = {
    rejectUnauthorized: config.rejectUnauthorized,
    servername: host,
  }
  if (config.caFile !== undefined && config.caFile !== '') {
    options.ca = [readFileSync(config.caFile)]
  }
  return options
}

/**
 * Open a directory connection over LDAPS, or plain LDAP upgraded with STARTTLS.
 * @param config - URL, TLS policy, and timeouts.
 * @returns an open connection; the caller must `unbind` it.
 */
export const connectDirectory: DirectoryConnector = async (config) => {
  const tlsOptions = tlsOptionsFor(config)

  const client = new Client({
    url: config.url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
    tlsOptions,
  })

  if (config.startTls) await client.startTLS(tlsOptions)

  const connection: DirectoryConnection = {
    async bind(dn, password) {
      await client.bind(dn, password)
    },
    async search(search: DirectorySearch) {
      const result = await client.search(search.base, {
        scope: 'sub',
        filter: search.filter,
        ...(search.sizeLimit === undefined ? {} : { sizeLimit: search.sizeLimit }),
        attributes: [...search.attributes],
      })
      return result.searchEntries.map((entry) => normalize(entry as RawEntry))
    },
    async unbind() {
      await client.unbind()
    },
  }
  return connection
}
