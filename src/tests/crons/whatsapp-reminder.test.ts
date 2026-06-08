import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { sendWhatsappReminders } from '../../crons/whatsapp-reminder.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn(),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
}))

function matchIn(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000)
}

describe('sendWhatsappReminders', () => {
  beforeEach(() => {
    mockSendWhatsappMessage.mockReset()
    mockSendWhatsappMessage.mockResolvedValue(undefined)
  })

  it('sends message to participant without prediction and creates MatchReminder row', async () => {
    const participant = await buildParticipant({ hasPhone: true, phone: '+573001234567' })
    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(matchIn(45)).build()

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('Polla Mundial 2026'),
    )

    const reminder = await prisma.matchReminder.findUnique({
      where: { matchId_participantId: { matchId: match.id, participantId: participant.id } },
    })
    expect(reminder).not.toBeNull()
  })

  it('skips participant who already has a KoPrediction', async () => {
    const participant = await buildParticipant({ hasPhone: true })
    const team = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withScheduledAt(matchIn(45))
      .withHomeTeamId(team.id)
      .build()

    await prisma.koPrediction.create({
      data: {
        participantId: participant.id,
        matchId: match.id,
        scoreHome: 1,
        scoreAway: 0,
        teamAdvancesId: team.id,
        tripleActive: false,
      },
    })

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('skips participant who already received a reminder', async () => {
    const participant = await buildParticipant({ hasPhone: true })
    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(matchIn(45)).build()

    await prisma.matchReminder.create({
      data: { matchId: match.id, participantId: participant.id },
    })

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('skips matches scheduled more than 1 hour away', async () => {
    await buildParticipant({ hasPhone: true })
    await new MatchBuilder().withRoundSlug('R32').withScheduledAt(matchIn(90)).build()

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('skips matches that have already started (scheduledAt in the past)', async () => {
    await buildParticipant({ hasPhone: true })
    await new MatchBuilder()
      .withRoundSlug('R32')
      .withScheduledAt(new Date(Date.now() - 10 * 60 * 1000))
      .build()

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('skips GROUP round matches', async () => {
    await buildParticipant({ hasPhone: true })
    await new MatchBuilder().withRoundSlug('GROUP').withScheduledAt(matchIn(45)).build()

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('skips participants without phone (hasPhone=false)', async () => {
    await buildParticipant({ hasPhone: false, phone: null })
    await new MatchBuilder().withRoundSlug('R32').withScheduledAt(matchIn(45)).build()

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('continues to other participants if one send fails, does not create reminder for failed send', async () => {
    const p1 = await buildParticipant({ hasPhone: true, phone: '+573001111111' })
    const p2 = await buildParticipant({ hasPhone: true, phone: '+573002222222' })
    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(matchIn(45)).build()

    mockSendWhatsappMessage
      .mockRejectedValueOnce(new Error('WA timeout'))
      .mockResolvedValueOnce(undefined)

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)

    const reminders = await prisma.matchReminder.findMany({ where: { matchId: match.id } })
    expect(reminders).toHaveLength(1)

    const p1Reminder = await prisma.matchReminder.findFirst({
      where: { matchId: match.id, participantId: p1.id },
    })
    const p2Reminder = await prisma.matchReminder.findFirst({
      where: { matchId: match.id, participantId: p2.id },
    })
    // The second call succeeded → its participant gets a reminder row
    // The first call failed → no row (retried next tick)
    expect(p1Reminder === null || p2Reminder === null).toBe(true)
  })

  it('continues processing next match if one match send errors', async () => {
    const participant = await buildParticipant({ hasPhone: true })
    const match1 = await new MatchBuilder()
      .withRoundSlug('R32')
      .withScheduledAt(matchIn(45))
      .build()
    const match2 = await new MatchBuilder()
      .withRoundSlug('R16')
      .withScheduledAt(matchIn(50))
      .build()

    mockSendWhatsappMessage
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined)

    await sendWhatsappReminders()

    expect(mockSendWhatsappMessage).toHaveBeenCalledTimes(2)

    const p1Reminder = await prisma.matchReminder.findFirst({
      where: { matchId: match1.id, participantId: participant.id },
    })
    const p2Reminder = await prisma.matchReminder.findFirst({
      where: { matchId: match2.id, participantId: participant.id },
    })
    // At least one match succeeded
    expect(p1Reminder !== null || p2Reminder !== null).toBe(true)
  })

  it('runs without throwing when no matches are pending', async () => {
    await expect(sendWhatsappReminders()).resolves.not.toThrow()
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })
})
