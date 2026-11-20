#!/usr/bin/env node
/**
 * Account-file maintenance for deployments that authenticate locally.
 *
 * Run as `dsh-auth-ldap <command>`. Kept out of the web UI on purpose: the UI is
 * itself gated, so account bootstrap must not depend on being logged in.
 * @module dsh-auth-ldap/cli
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

import { hashPassword } from './password.js'
import { type Account, type UsersFile, loadUsers, saveUsers, upsertAccount } from './users.js'

/** Default account file when neither `--file` nor `DSH_AUTH_LDAP_USERS` is set. */
export function defaultUsersFile(): string {
  const fromEnvironment = process.env.DSH_AUTH_LDAP_USERS
  if (fromEnvironment !== undefined && fromEnvironment !== '') return resolve(fromEnvironment)
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'auth-ldap', 'users.json')
}

/** Parsed command line. */
interface Options {
  readonly command: string
  readonly accountId: string
  readonly displayName: string
  readonly roles: string[]
  readonly file: string
}

/**
 * Parse command-line arguments.
 * @param argv - arguments after the binary name.
 * @returns parsed options.
 * @throws when the invocation is not understood.
 */
export function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = []
  let displayName = ''
  let roles: string[] = []
  let file = ''

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (argument === '--display-name') {
      displayName = argv[index + 1] ?? ''
      index += 1
    } else if (argument === '--role') {
      roles = [...roles, argv[index + 1] ?? ''].filter((role) => role !== '')
      index += 1
    } else if (argument === '--file') {
      file = argv[index + 1] ?? ''
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option: ${argument}`)
    } else {
      positional.push(argument)
    }
  }

  const [command = '', accountId = ''] = positional
  if (command === '')
    throw new Error('usage: dsh-auth-ldap <add|passwd|disable|enable|list> [account]')
  return {
    command,
    accountId,
    displayName,
    roles: roles.length === 0 && command === 'add' ? ['admin'] : roles,
    file: file === '' ? defaultUsersFile() : resolve(file),
  }
}

/**
 * Read a password from a pipe, or prompt without echo on a terminal.
 * @param prompt - prompt text for interactive use.
 * @returns the password without a trailing newline.
 */
export async function readPassword(prompt: string): Promise<string> {
  if (process.stdin.isTTY !== true) {
    const chunks: Buffer[] = []
    const stream = process.stdin as AsyncIterable<Buffer>
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/u, '')
  }

  process.stderr.write(prompt)
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
  try {
    return await new Promise<string>((resolveLine) => {
      rl.question('', (answer) => {
        process.stderr.write('\n')
        resolveLine(answer)
      })
    })
  } finally {
    rl.close()
  }
}

/**
 * Apply one command to the account file.
 * @param options - parsed command line.
 * @param password - password for `add` and `passwd`; ignored otherwise.
 * @returns the document to persist, or `undefined` for read-only commands.
 */
export async function applyCommand(
  options: Options,
  password: string,
): Promise<UsersFile | undefined> {
  const file = await loadUsers(options.file)
  const wanted = options.accountId.trim().toLowerCase()
  const existing = file.accounts.find((account) => account.id.toLowerCase() === wanted)

  switch (options.command) {
    case 'add': {
      if (options.accountId.trim() === '') throw new Error('add requires an account name')
      if (existing !== undefined) throw new Error(`account already exists: ${options.accountId}`)
      const account: Account = {
        id: options.accountId.trim().toLowerCase(),
        displayName: options.displayName === '' ? options.accountId.trim() : options.displayName,
        roles: options.roles,
        disabled: false,
        password: await hashPassword(password),
      }
      return upsertAccount(file, account)
    }
    case 'passwd': {
      if (existing === undefined) throw new Error(`unknown account: ${options.accountId}`)
      return upsertAccount(file, { ...existing, password: await hashPassword(password) })
    }
    case 'disable': {
      if (existing === undefined) throw new Error(`unknown account: ${options.accountId}`)
      return upsertAccount(file, { ...existing, disabled: true })
    }
    case 'enable': {
      if (existing === undefined) throw new Error(`unknown account: ${options.accountId}`)
      return upsertAccount(file, { ...existing, disabled: false })
    }
    case 'list': {
      process.stdout.write(
        `${file.accounts
          .map(
            (account) =>
              `${account.id}\t${account.roles.join(',') || '-'}\t${account.disabled ? 'disabled' : 'active'}\t${account.displayName}`,
          )
          .join('\n')}\n`,
      )
      return undefined
    }
    default:
      throw new Error(`unknown command: ${options.command}`)
  }
}

/** Run the CLI, mapping failures to a non-zero exit status. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const needsPassword = options.command === 'add' || options.command === 'passwd'
  const password = needsPassword ? await readPassword('Password: ') : ''
  const updated = await applyCommand(options, password)
  if (updated !== undefined) {
    await saveUsers(options.file, updated)
    process.stderr.write(`wrote ${String(updated.accounts.length)} account(s) to ${options.file}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
