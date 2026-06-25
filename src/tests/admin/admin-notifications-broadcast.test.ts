import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildServer } from '../../server.js'
import {
  createAuthenticatedParticipant,
  createAuthenticatedAdmin,
} from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn(),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
}))

describe('POST /admin/notifications/broadcast', () => {
  beforeEach(() => {
    mockSendWhatsappMessage.mockReset()
  })

  it('GROUP_PHASE_LAST_ROUND_REMINDER → 200 + personalized position, body and app link', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildParticipant({ name: 'Alice', email: 'alice@test.com', hasPhone: true, phone: '+573001111111' })
    await buildParticipant({ name: 'Bob', email: 'bob@test.com', hasPhone: true, phone: '+573002222222' })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: {
        type: 'GROUP_PHASE_LAST_ROUND_REMINDER',
        message: 'Estamos en instancias finales, ¡no te confíes!',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 2, sent: 2, failed: 0, skipped: 0 })

    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)
    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('posición')
    expect(text).toContain('Estamos en instancias finales')
    expect(text).toContain('https://app.paulpredice.com')
    expect(text).not.toContain('Alice')
    expect(text).not.toContain('Bob')
  })

  it('GENERIC → 200 + body verbatim plus app link footer', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildParticipant({ name: 'Alice', email: 'alice@test.com', hasPhone: true, phone: '+573001111111' })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: 'Mensaje libre del admin' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 1, sent: 1, failed: 0, skipped: 0 })

    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(1)
    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toBe('Mensaje libre del admin\n\n👉 https://app.paulpredice.com')
    expect(text).not.toContain('PaulPredice*')
    expect(text).not.toContain('posición')
  })

  it('participantIds subset → 200 + only those receive the message', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const p1 = await buildParticipant({ name: 'Alice', email: 'alice@test.com', hasPhone: true, phone: '+573001111111' })
    const p2 = await buildParticipant({ name: 'Bob', email: 'bob@test.com', hasPhone: true, phone: '+573002222222' })
    await buildParticipant({ name: 'Carol', email: 'carol@test.com', hasPhone: true, phone: '+573003333333' })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: 'Solo a algunos', participantIds: [p1.id, p2.id] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 2, sent: 2, failed: 0, skipped: 0 })

    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)
    const phones = mockSendWhatsappMessage.mock.calls.map((c) => c[0])
    expect(phones).toEqual(expect.arrayContaining(['+573001111111', '+573002222222']))
    expect(phones).not.toContain('+573003333333')
  })

  it('excludes participants without a phone from total', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildParticipant({ name: 'Alice', email: 'alice@test.com', hasPhone: true, phone: '+573001111111' })
    await buildParticipant({ name: 'Dan', email: 'dan@test.com', hasPhone: false, phone: null })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: 'Hola' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(1)
  })

  it('empty message → 400 MESSAGE_REQUIRED', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: '   ' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('MESSAGE_REQUIRED')
  })

  it('invalid type → 400 INVALID_NOTIFICATION_TYPE', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'NOPE', message: 'Hola' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_NOTIFICATION_TYPE')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      payload: { type: 'GENERIC', message: 'Hola' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: 'Hola' },
    })
    expect(res.statusCode).toBe(403)
  })
})
