import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedAdmin, createAuthenticatedParticipant } from '../helpers/auth.helper.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
  getWhatsappStatus: vi.fn().mockReturnValue({ connected: false, qrPending: false }),
  getLastQr: vi.fn().mockReturnValue(null),
  waitUntilConnected: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /admin/invitations', () => {
  it('success without phone → 201 + valid invitation, no WhatsApp sent', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBeDefined()
    expect(body.code).toMatch(/^[A-Z]{4}[0-9]{4}$/)
    expect(body.phone).toBeNull()
    expect(body.status).toBe('AVAILABLE')
    expect(body.usedAt).toBeNull()
    expect(body.expiresAt).toBeDefined()
    expect(body.createdAt).toBeDefined()

    const expiresAt = new Date(body.expiresAt)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())

    const row = await prisma.invitation.findUnique({ where: { id: body.id } })
    expect(row).not.toBeNull()
    expect(row!.code).toBe(body.code)
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('success with phone → 201 + WhatsApp sent with code and link', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
      payload: { phone: '+573001234567' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.phone).toBe('+573001234567')

    await vi.waitFor(() => expect(mockSendWhatsappMessage).toHaveBeenCalledOnce())
    const [sentPhone, sentMsg] = mockSendWhatsappMessage.mock.calls[0]
    expect(sentPhone).toBe('+573001234567')
    expect(sentMsg).toContain(body.code)
    expect(sentMsg).toContain('paulpredice.com')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/invitations' })
    expect(res.statusCode).toBe(401)
  })

  it('non-admin participant → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(403)
  })
})
