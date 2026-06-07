import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../server.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { signSession } from '../../lib/session.js'

describe('authenticate middleware', () => {
  it('valid session cookie → attaches user, health route responds 200', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const server = await buildServer()
    // Register a test-only protected route
    server.get('/test-protected', { preHandler: [server.authenticate] }, async (req) => {
      return { userId: req.user.id }
    })
    await server.ready()

    const res = await server.inject({
      method: 'GET',
      url: '/test-protected',
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().userId).toBe(participant.id)
  })

  it('missing cookie → 401 MISSING_SESSION', async () => {
    const server = await buildServer()
    server.get('/test-protected', { preHandler: [server.authenticate] }, async () => ({ ok: true }))
    await server.ready()

    const res = await server.inject({
      method: 'GET',
      url: '/test-protected',
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('MISSING_SESSION')
  })

  it('invalid JWT → 401 INVALID_SESSION', async () => {
    const server = await buildServer()
    server.get('/test-protected', { preHandler: [server.authenticate] }, async () => ({ ok: true }))
    await server.ready()

    const res = await server.inject({
      method: 'GET',
      url: '/test-protected',
      cookies: { session: 'bad.jwt.token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_SESSION')
  })
})
