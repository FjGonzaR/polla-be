import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildServer } from '../../server.js'
import { buildInvitation } from '../builders/invitation.builder.js'
import { buildParticipant } from '../builders/participant.builder.js'

const { mockVerifyGoogleToken, mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockVerifyGoogleToken: vi.fn(),
  mockSendWhatsappMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/google-auth.js', () => ({
  verifyGoogleToken: mockVerifyGoogleToken,
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
  getWhatsappStatus: vi.fn().mockReturnValue({ connected: false, qrPending: false }),
  getLastQr: vi.fn().mockReturnValue(null),
  waitUntilConnected: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /auth/google', () => {
  const ADMIN_PHONE = '+573023595622'

  beforeEach(() => {
    mockVerifyGoogleToken.mockReset()
    mockSendWhatsappMessage.mockReset()
    mockSendWhatsappMessage.mockResolvedValue(undefined)
  })

  it('signup: new user with valid code and phone → 200, cookie set, participant created', async () => {
    const invitation = await buildInvitation({ code: 'SIGNUP1' })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-new-uid',
      email: 'new@test.com',
      name: 'New User',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', code: 'SIGNUP1', phone: '+573001234567' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.email).toBe('new@test.com')
    expect(body.name).toBe('New User')
    expect(res.headers['set-cookie']).toMatch(/session=/)

    const created = await prisma.participant.findUnique({ where: { googleId: 'google-new-uid' } })
    expect(created).not.toBeNull()
    expect(created!.phone).toBe('+573001234567')
    expect(created!.hasPhone).toBe(true)

    const inv = await prisma.invitation.findUnique({ where: { id: invitation.id } })
    expect(inv!.status).toBe('USED')
  })

  it('signup: sends WhatsApp welcome message to participant phone', async () => {
    await buildInvitation({ code: 'WELC01' })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-welcome-uid',
      email: 'welcome@test.com',
      name: 'Welcome User',
    })

    const server = await buildServer()
    await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', code: 'WELC01', phone: '+573009876543' },
    })

    await vi.waitFor(() => expect(mockSendWhatsappMessage).toHaveBeenCalledOnce())
    const [sentPhone, sentMsg] = mockSendWhatsappMessage.mock.calls[0]
    expect(sentPhone).toBe('+573009876543')
    expect(sentMsg).toContain('PaulPredice')
    expect(sentMsg).toContain('paulpredice.com')
  })

  it('login: existing user → 200, cookie set, no duplicate participant, no WhatsApp', async () => {
    const participant = await buildParticipant({ googleId: 'google-existing' })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-existing',
      email: participant.email,
      name: participant.name,
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['set-cookie']).toMatch(/session=/)

    const count = await prisma.participant.count({ where: { googleId: 'google-existing' } })
    expect(count).toBe(1)
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('new user without code/phone → 403 NEEDS_SIGNUP', async () => {
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-unknown',
      email: 'unknown@test.com',
      name: 'Unknown',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NEEDS_SIGNUP')
  })

  it('new user with used invitation → 409 INVITE_USED_OR_EXPIRED', async () => {
    await buildInvitation({ code: 'USED01', status: 'USED' })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-used-inv',
      email: 'a@test.com',
      name: 'A',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', code: 'USED01', phone: '+573001234567' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('INVITE_USED_OR_EXPIRED')
  })

  it('new user with invalid phone format ��� 400 INVALID_PHONE', async () => {
    await buildInvitation({ code: 'PHONE1' })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-bad-phone',
      email: 'b@test.com',
      name: 'B',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', code: 'PHONE1', phone: '3001234567' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_PHONE')
  })

  it('invalid Google credential → 401 INVALID_CREDENTIAL', async () => {
    mockVerifyGoogleToken.mockImplementationOnce(async () => {
      throw new Error('Token invalid')
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'bad-token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_CREDENTIAL')
  })

  it('admin first login: phone matches ADMIN_PHONES → 200, role=ADMIN, no invite needed', async () => {
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-admin-sub',
      email: 'admin@test.com',
      name: 'Admin',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', phone: ADMIN_PHONE },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['set-cookie']).toMatch(/session=/)
    const created = await prisma.participant.findUnique({ where: { googleId: 'google-admin-sub' } })
    expect(created!.role).toBe('ADMIN')
    expect(created!.phone).toBe(ADMIN_PHONE)
    expect(created!.invitationId).toBeNull()
  })

  it('admin re-login: existing admin → 200, no duplicate', async () => {
    await buildParticipant({ googleId: 'google-admin-sub', role: 'ADMIN', phone: ADMIN_PHONE })
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-admin-sub',
      email: 'admin@test.com',
      name: 'Admin',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token' },
    })

    expect(res.statusCode).toBe(200)
    const count = await prisma.participant.count({ where: { googleId: 'google-admin-sub' } })
    expect(count).toBe(1)
  })

  it('new user with non-existent code → 404 INVITE_NOT_FOUND', async () => {
    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-no-code',
      email: 'c@test.com',
      name: 'C',
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { 'content-type': 'application/json' },
      payload: { credential: 'valid-token', code: 'NOEXISTS', phone: '+573001234567' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('INVITE_NOT_FOUND')
  })
})
