import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'

import { parseConfig } from '../src/config.js'
import { createStatusHandler, PHASE, statusPayload } from '../src/routes/status.js'

interface CapturedResponse {
  status?: number
  headers: Record<string, string | number>
  body?: string | undefined
}

/** Minimal `ServerResponse` double capturing what the handler writes. */
function createResponse(captured: CapturedResponse): ServerResponse {
  return {
    writeHead(status: number, headers: Record<string, string | number> = {}) {
      captured.status = status
      captured.headers = headers
      return this
    },
    end(chunk?: string) {
      captured.body = chunk
    },
  } as unknown as ServerResponse
}

function createRequest(method: string): IncomingMessage {
  return { method } as IncomingMessage
}

const config = parseConfig({
  local: { enabled: true, usersFile: '/var/lib/dsh/users.yaml' },
  session: { cookieName: 'dsh_auth_ldap', ttlSeconds: 900 },
})

describe('statusPayload', () => {
  it('reports deployment shape without endpoints or secrets', () => {
    const payload = statusPayload(config)

    expect(payload.plugin).toBe('dsh-auth-ldap')
    expect(payload.phase).toBe(PHASE)
    expect(payload.backends).toEqual({ local: true, ldap: false })
    expect(payload.session).toEqual({ cookieName: 'dsh_auth_ldap', ttlSeconds: 900 })
    expect(JSON.stringify(payload)).not.toContain('users.yaml')
  })
})

describe('createStatusHandler', () => {
  it('answers GET with a non-cacheable JSON document', () => {
    const captured: CapturedResponse = { headers: {} }
    createStatusHandler(config)(createRequest('GET'), createResponse(captured))

    expect(captured.status).toBe(200)
    expect(captured.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(captured.headers['cache-control']).toBe('no-store')
    expect(captured.headers['x-content-type-options']).toBe('nosniff')
    expect(JSON.parse(captured.body ?? '{}')).toMatchObject({ plugin: 'dsh-auth-ldap' })
  })

  it('answers HEAD without a body', () => {
    const captured: CapturedResponse = { headers: {} }
    createStatusHandler(config)(createRequest('HEAD'), createResponse(captured))

    expect(captured.status).toBe(200)
    expect(captured.body).toBeUndefined()
  })

  it('rejects other methods', () => {
    const captured: CapturedResponse = { headers: {} }
    createStatusHandler(config)(createRequest('POST'), createResponse(captured))

    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe('GET, HEAD')
  })
})
