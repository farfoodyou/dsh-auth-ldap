import { describe, expect, it } from 'vitest'

import { DEFAULT_PARAMS, hashPassword, verifyPassword } from '../src/password.js'

describe('hashPassword', () => {
  it('produces a scrypt record with salt and hash', async () => {
    const record = await hashPassword('correct horse battery')

    expect(record.scheme).toBe('scrypt')
    expect(record.N).toBe(DEFAULT_PARAMS.N)
    expect(Buffer.from(record.salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(record.hash, 'base64')).toHaveLength(32)
    expect(record.hash).not.toContain('correct horse')
  })

  it('salts every record independently', async () => {
    const first = await hashPassword('same password')
    const second = await hashPassword('same password')

    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
  })

  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/u)
  })
})

describe('verifyPassword', () => {
  it('accepts the matching password and rejects others', async () => {
    const record = await hashPassword('s3cret-passphrase')

    await expect(verifyPassword(record, 's3cret-passphrase')).resolves.toBe(true)
    await expect(verifyPassword(record, 's3cret-passphras')).resolves.toBe(false)
    await expect(verifyPassword(record, '')).resolves.toBe(false)
  })

  it('rejects a record with an unexpected key length', async () => {
    const record = await hashPassword('s3cret-passphrase')
    const tampered = { ...record, hash: Buffer.alloc(8).toString('base64') }

    await expect(verifyPassword(tampered, 's3cret-passphrase')).resolves.toBe(false)
  })

  it('rejects an unsupported scheme', async () => {
    const record = await hashPassword('s3cret-passphrase')

    await expect(verifyPassword({ ...record, scheme: 'md5' as 'scrypt' }, 'x')).resolves.toBe(false)
  })
})
