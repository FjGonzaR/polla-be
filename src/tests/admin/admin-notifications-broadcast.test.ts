import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildServer } from '../../server.js'
import {
  createAuthenticatedParticipant,
  createAuthenticatedAdmin,
} from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { prisma } from '../../lib/prisma.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { flushBackground } from '../../lib/background.js'

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

  it('GROUP_PHASE_LAST_ROUND_REMINDER → 202 + personalized position, body and app link', async () => {
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

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ status: 'queued' })

    await flushBackground()
    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)
    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('posición')
    expect(text).toContain('Estamos en instancias finales')
    expect(text).toContain('https://app.paulpredice.com')
    expect(text).not.toContain('Alice')
    expect(text).not.toContain('Bob')
  })

  it('GENERIC → 202 + body plus CTA and app link footer', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildParticipant({ name: 'Alice', email: 'alice@test.com', hasPhone: true, phone: '+573001111111' })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'GENERIC', message: 'Mensaje libre del admin' },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ status: 'queued' })

    await flushBackground()
    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(1)
    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    // body first, then a CTA line, then the URL alone on its own line (for link detection)
    expect(text.startsWith('Mensaje libre del admin\n\n')).toBe(true)
    expect(text.endsWith('\n\nhttps://app.paulpredice.com')).toBe(true)
    expect(text.length).toBeGreaterThan(
      'Mensaje libre del admin\n\n\n\nhttps://app.paulpredice.com'.length,
    )
    expect(text).not.toContain('PaulPredice*')
    expect(text).not.toContain('posición')
  })

  it('participantIds subset → 202 + only those receive the message', async () => {
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

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ status: 'queued' })

    await flushBackground()
    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)
    const phones = mockSendWhatsappMessage.mock.calls.map((c) => c[0])
    expect(phones).toEqual(expect.arrayContaining(['+573001111111', '+573002222222']))
    expect(phones).not.toContain('+573003333333')
  })

  it('excludes participants without a phone', async () => {
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

    expect(res.statusCode).toBe(202)

    await flushBackground()
    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(1)
    expect(mockSendWhatsappMessage.mock.calls[0][0]).toBe('+573001111111')
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

  it('DAILY_RECAP with a day → 202 + involved participant recap (no message needed)', async () => {
    mockSendWhatsappMessage.mockResolvedValue(undefined)
    const { cookie } = await createAuthenticatedAdmin()
    const participant = await buildParticipant({ email: 'recap@test.com', googleId: 'g-recap', hasPhone: true, phone: '+573009999999' })
    const home = await new TeamBuilder().withName('Brasil').build()
    const away = await new TeamBuilder().withName('Croacia').build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withScheduledAt(new Date('2026-06-20T20:00:00Z'))
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withResult(2, 1, home.id)
      .build()
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })
    await prisma.scoreEvent.create({
      data: { participantId: participant.id, paramKey: 'pts_ko_advances', matchId: match.id, roundSlug: 'R32', points: 8 },
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'DAILY_RECAP', day: '2026-06-20' },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ status: 'queued' })

    await flushBackground()
    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage.mock.calls[0][0]).toBe('+573009999999')
    expect(mockSendWhatsappMessage.mock.calls[0][1]).toContain('*Brasil 2-1 Croacia*')
  })

  it('DAILY_RECAP for a day with no KO matches → 202 + nobody messaged', async () => {
    const { cookie } = await createAuthenticatedAdmin()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'DAILY_RECAP', day: '2026-06-20' },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ status: 'queued' })

    await flushBackground()
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('DAILY_RECAP with invalid day → 400 INVALID_DAY', async () => {
    const { cookie } = await createAuthenticatedAdmin()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/notifications/broadcast',
      headers: { cookie },
      payload: { type: 'DAILY_RECAP', day: 'not-a-date' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_DAY')
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
