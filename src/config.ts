/**
 * Configuration schema and cross-field validation for `dsh-auth-ldap`.
 *
 * Every field carries a default so that the bundle layer can mount the plugin
 * without configuration and the user layer only overrides what it needs.
 * @module dsh-auth-ldap/config
 */

import z from '@deepseek-ai/schemastery'

/**
 * How the gate treats a request it cannot authenticate.
 *
 * - `gate`: deny the request (phase 1 behaviour).
 * - `observe`: admit the request and log the decision; used to stage a rollout
 *   without locking anyone out.
 *
 * The default is `gate`: a security control should fail closed, and a mount
 * without a usable backend is rejected with an actionable error instead of
 * silently admitting everyone.
 */
export type GateMode = 'gate' | 'observe'

/** Local password file backend. */
export interface LocalBackendConfig {
  /** Whether the local account file participates in login. */
  enabled: boolean
  /** Absolute path to the account file; `~` is expanded by the plugin. */
  usersFile: string
}

/** LDAP / Active Directory bind backend. */
export interface LdapBackendConfig {
  /** Whether the directory participates in login. */
  enabled: boolean
  /** Directory URL, `ldap://` or `ldaps://`, host and optional port only. */
  url: string
  /** Base DN searched for the login account. */
  userSearchBase: string
  /** User filter; `{{username}}` is replaced with the RFC 4515 escaped login name. */
  userSearchFilter: string
  /** Service account DN used for the search; empty means anonymous search. */
  bindDn: string
  /** Environment variable holding the service account password. */
  bindPasswordEnv: string
  /** PEM CA bundle used to verify the directory certificate; empty uses the system roots. */
  caFile: string
  /** Attribute read as the display name; falls back to the login name. */
  displayNameAttribute: string
  /** Base DN searched for groups; empty disables group mapping. */
  groupSearchBase: string
  /** Group filter; `{{dn}}` is replaced with the RFC 4515 escaped user DN. */
  groupSearchFilter: string
  /** Attribute read as the group name, matched against `adminGroups`. */
  groupNameAttribute: string
  /** Group names or DNs whose members receive the `admin` role. */
  adminGroups: string[]
  /** Upgrade a plain `ldap://` connection with STARTTLS before binding. */
  startTls: boolean
  /** Verify the directory server certificate; never disable outside a lab. */
  rejectUnauthorized: boolean
  /** Connect and search timeout in milliseconds. */
  timeoutMs: number
}

/** Where the plugin keeps its signing key and session table. */
export interface StorageConfig {
  /** Directory for the signing key and session table; empty uses `$DSH_HOME/storages/auth-ldap`. */
  dir: string
}

/** Browser session cookie policy. */
export interface SessionConfig {
  /** Cookie name; must be unique per deployment behind a shared parent domain. */
  cookieName: string
  /** Absolute session lifetime in seconds. */
  ttlSeconds: number
  /** Emit `Secure`; keep enabled whenever the browser leg is HTTPS. */
  secure: boolean
}

/** Complete plugin configuration. */
export interface Config {
  /** Gate behaviour for unauthenticated requests. */
  mode: GateMode
  /** Host shown on the login page; empty falls back to the request `Host` header. */
  publicHost: string
  /** Login page path, used by the guard to allow it through. */
  loginPath: string
  /** Logout path. */
  logoutPath: string
  /** Path of the unauthenticated status document. */
  statusPath: string
  /** Reverse proxies whose forwarded client-IP headers are trusted. */
  trustedProxyCidrs: string[]
  /** Extra `host[:port]` origins accepted for the login POST (proxy rewrites, dual entry points). */
  allowedOrigins: string[]
  /** Header carrying the client address when the peer is a trusted proxy. */
  clientIpHeader: string
  /** Local account backend. */
  local: LocalBackendConfig
  /** Directory backend. */
  ldap: LdapBackendConfig
  /** Plugin storage location. */
  storage: StorageConfig
  /** Session cookie policy. */
  session: SessionConfig
}

/** Default login page path. */
export const DEFAULT_LOGIN_PATH = '/auth/login'

/** Default logout path. */
export const DEFAULT_LOGOUT_PATH = '/auth/logout'

/** Default status document path. */
export const DEFAULT_STATUS_PATH = '/auth-ldap/status'

/** Validated configuration schema; loading fails on unknown or invalid values. */
export const Config: z<Config> = z.object({
  mode: z.union(['gate', 'observe'] as const).default('gate'),
  publicHost: z.string().default(''),
  loginPath: z.string().default(DEFAULT_LOGIN_PATH),
  logoutPath: z.string().default(DEFAULT_LOGOUT_PATH),
  statusPath: z.string().default(DEFAULT_STATUS_PATH),
  trustedProxyCidrs: z.array(z.string()).default([]),
  allowedOrigins: z.array(z.string()).default([]),
  clientIpHeader: z.string().default('x-forwarded-for'),
  local: z.object({
    enabled: z.boolean().default(false),
    usersFile: z.string().default(''),
  }),
  ldap: z.object({
    enabled: z.boolean().default(false),
    url: z.string().default(''),
    userSearchBase: z.string().default(''),
    userSearchFilter: z.string().default('(uid={{username}})'),
    bindDn: z.string().default(''),
    bindPasswordEnv: z.string().default(''),
    caFile: z.string().default(''),
    displayNameAttribute: z.string().default('displayName'),
    groupSearchBase: z.string().default(''),
    groupSearchFilter: z.string().default('(member={{dn}})'),
    groupNameAttribute: z.string().default('cn'),
    adminGroups: z.array(z.string()).default([]),
    startTls: z.boolean().default(false),
    rejectUnauthorized: z.boolean().default(true),
    timeoutMs: z.natural().min(1000).max(120_000).default(10_000),
  }),
  storage: z.object({
    dir: z.string().default(''),
  }),
  session: z.object({
    cookieName: z.string().default('dsh_auth_ldap'),
    ttlSeconds: z.natural().min(60).max(2_592_000).default(43_200),
    secure: z.boolean().default(true),
  }),
})

/**
 * Validate untrusted loader input into a `Config`.
 *
 * The Cordis loader hands plugin configuration in as an untyped value and
 * relies on the schema to reject unknown or mistyped fields; this helper is the
 * single typed entry point for that conversion, for tests, and for callers that
 * already hold a parsed document.
 * @param input - raw configuration value.
 * @returns the validated configuration with every default applied.
 * @throws when the input violates the schema.
 */
export function parseConfig(input: unknown): Config {
  return (Config as unknown as (value: unknown) => Config)(input)
}

/** IPv4 or IPv6 CIDR block, used to reject malformed proxy allowlists. */
const CIDR_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/

/** LDAP or LDAPS URL with host and optional port only. */
const DIRECTORY_URL_PATTERN = /^ldaps?:\/\/[^\s/]+$/

/**
 * Report configuration problems the schema cannot express.
 *
 * The schema validates shapes and ranges; this function validates
 * relationships between fields, such as "an enabled backend must be usable".
 * @param config - validated configuration.
 * @returns human-readable problems; an empty array means the configuration is usable.
 */
export function validateConfig(config: Config): string[] {
  const problems: string[] = []

  if (!config.local.enabled && !config.ldap.enabled && config.mode === 'gate') {
    problems.push('gate mode requires at least one backend: enable local or ldap')
  }

  if (config.local.enabled && config.local.usersFile.trim() === '') {
    problems.push('local.usersFile must be set when the local backend is enabled')
  }

  if (config.ldap.enabled) {
    if (!DIRECTORY_URL_PATTERN.test(config.ldap.url)) {
      problems.push('ldap.url must look like ldaps://host or ldap://host:389')
    }
    if (config.ldap.userSearchBase.trim() === '') {
      problems.push('ldap.userSearchBase must be set when the ldap backend is enabled')
    }
    if (!config.ldap.userSearchFilter.includes('{{username}}')) {
      problems.push('ldap.userSearchFilter must contain the {{username}} placeholder')
    }
    if (config.ldap.bindDn.trim() !== '' && config.ldap.bindPasswordEnv.trim() === '') {
      problems.push('ldap.bindPasswordEnv must name the service account password variable')
    }
    if (
      config.ldap.groupSearchBase.trim() !== '' &&
      !config.ldap.groupSearchFilter.includes('{{dn}}')
    ) {
      problems.push('ldap.groupSearchFilter must contain the {{dn}} placeholder')
    }
    if (!config.ldap.startTls && config.ldap.url.startsWith('ldap://')) {
      problems.push('plain ldap:// without startTls sends credentials in clear text')
    }
  }

  for (const cidr of config.trustedProxyCidrs) {
    if (!CIDR_PATTERN.test(cidr))
      problems.push(`trustedProxyCidrs entry is not a CIDR block: ${cidr}`)
  }

  for (const [name, path] of [
    ['loginPath', config.loginPath],
    ['logoutPath', config.logoutPath],
    ['statusPath', config.statusPath],
  ] as const) {
    if (!path.startsWith('/') || path.endsWith('/')) {
      problems.push(`${name} must be an absolute path without a trailing slash`)
    }
  }

  return problems
}

/**
 * Report configuration facts that are worth a log line but must not stop the mount.
 *
 * These are deployment smells rather than errors: a plugin that refuses to load
 * cannot be diagnosed from the running instance.
 * @param config - validated configuration.
 * @returns human-readable warnings; an empty array means nothing to report.
 */
export function configWarnings(config: Config): string[] {
  const warnings: string[] = []

  if (!config.local.enabled && !config.ldap.enabled) {
    warnings.push(
      'no credential backend is enabled; nothing can authenticate until one is configured',
    )
  }

  if (config.mode === 'gate' && !config.ldap.enabled && config.local.enabled) {
    warnings.push('local accounts are the only backend; a lost password file locks everyone out')
  }

  if (config.mode === 'gate' && !config.local.enabled) {
    warnings.push('gate mode without local accounts leaves only the launch-token URL for access')
  }

  if (config.ldap.enabled && !config.ldap.rejectUnauthorized) {
    warnings.push('ldap.rejectUnauthorized is disabled; the directory certificate is not verified')
  }

  return warnings
}
