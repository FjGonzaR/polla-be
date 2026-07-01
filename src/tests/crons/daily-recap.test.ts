import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Match, Team } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { broadcastDailyRecap } from '../../services/notifications/daily-recap.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn(),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
}))

// Bogota day used across tests. 20:00 UTC = 15:00 Bogota, safely inside the window.
const DAY = '2026-06-20'
const IN_WINDOW = new Date('2026-06-20T20:00:00Z')

async function buildFinishedKoMatch(
  home: Team,
  away: Team,
  scoreHome: number,
  scoreAway: number,
  winnerTeamId: string,
): Promise<Match> {
  return new MatchBuilder()
    .withRoundSlug('R32')
    .withScheduledAt(IN_WINDOW)
    .withHomeTeamId(home.id)
    .withAwayTeamId(away.id)
    .withResult(scoreHome, scoreAway, winnerTeamId)
    .build()
}

describe('broadcastDailyRecap', () => {
  beforeEach(() => {
    mockSendWhatsappMessage.mockReset()
    mockSendWhatsappMessage.mockResolvedValue(undefined)
  })

  it('participant with KO prediction + score events → sends recap and records notification', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Brasil').build()
    const away = await new TeamBuilder().withName('Croacia').build()
    const match = await buildFinishedKoMatch(home, away, 2, 1, home.id)

    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })
    await prisma.scoreEvent.create({
      data: { participantId: participant.id, paramKey: 'pts_ko_advances', matchId: match.id, roundSlug: 'R32', points: 8 },
    })

    const result = await broadcastDailyRecap(DAY)

    expect(result).toEqual({ total: 1, sent: 1, failed: 0, skipped: 0 })
    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('*Brasil 2-1 Croacia*')
    expect(text).toContain('+8 pts')
    expect(text).toContain('Total: *+8 pts*')

    const notification = await prisma.notification.findFirst({
      where: { participantId: participant.id, type: 'DAILY_RECAP', dedupKey: DAY },
    })
    expect(notification).not.toBeNull()
  })

  it('promesa advanced → specific message', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Marruecos').build()
    const away = await new TeamBuilder().withName('Portugal').build()
    const notPlaying = await new TeamBuilder().withName('Idle').build()
    await buildFinishedKoMatch(home, away, 1, 0, home.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(home.id)
      .withDisappointmentTeamId(notPlaying.id)
      .build(participant.id)

    await broadcastDailyRecap(DAY)

    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('Tu promesa *Marruecos* ganó y avanza')
    expect(text).not.toContain('Tu decepción')
  })

  it('promesa eliminated → specific message', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Ghana').build()
    const away = await new TeamBuilder().withName('España').build()
    const notPlaying = await new TeamBuilder().withName('Idle').build()
    await buildFinishedKoMatch(home, away, 0, 2, away.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(home.id)
      .withDisappointmentTeamId(notPlaying.id)
      .build(participant.id)

    await broadcastDailyRecap(DAY)

    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('Tu promesa *Ghana* quedó eliminada')
  })

  it('decepción advanced → specific message', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Francia').build()
    const away = await new TeamBuilder().withName('Panamá').build()
    const notPlaying = await new TeamBuilder().withName('Idle').build()
    await buildFinishedKoMatch(home, away, 3, 0, home.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(notPlaying.id)
      .withDisappointmentTeamId(home.id)
      .build(participant.id)

    await broadcastDailyRecap(DAY)

    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('Tu decepción *Francia* avanzó')
    expect(text).not.toContain('Tu promesa')
  })

  it('decepción eliminated → specific message', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Alemania').build()
    const away = await new TeamBuilder().withName('Japón').build()
    const notPlaying = await new TeamBuilder().withName('Idle').build()
    await buildFinishedKoMatch(home, away, 0, 1, away.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(notPlaying.id)
      .withDisappointmentTeamId(home.id)
      .build(participant.id)

    await broadcastDailyRecap(DAY)

    const text = mockSendWhatsappMessage.mock.calls[0][1] as string
    expect(text).toContain('Tu decepción *Alemania* quedó eliminada. ¡Justo lo que querías!')
  })

  it('participant not involved → not notified', async () => {
    const involved = await buildParticipant()
    await buildParticipant({ email: 'bystander@test.com', googleId: 'g-bystander' })
    const home = await new TeamBuilder().withName('Uruguay').build()
    const away = await new TeamBuilder().withName('Corea').build()
    const match = await buildFinishedKoMatch(home, away, 1, 0, home.id)
    await buildKoPrediction({ participantId: involved.id, matchId: match.id, teamAdvancesId: home.id })

    const result = await broadcastDailyRecap(DAY)

    expect(result.total).toBe(1)
    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage.mock.calls[0][0]).toBe(involved.phone)
  })

  it('already notified for that day → skipped, no re-send', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Bélgica').build()
    const away = await new TeamBuilder().withName('Egipto').build()
    const match = await buildFinishedKoMatch(home, away, 2, 2, home.id)
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })
    await prisma.notification.create({
      data: { participantId: participant.id, type: 'DAILY_RECAP', dedupKey: DAY },
    })

    const result = await broadcastDailyRecap(DAY)

    expect(result).toEqual({ total: 1, sent: 0, failed: 0, skipped: 1 })
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('involved participant without phone → excluded', async () => {
    const participant = await buildParticipant({ hasPhone: false, phone: null })
    const home = await new TeamBuilder().withName('Chile').build()
    const away = await new TeamBuilder().withName('Perú').build()
    const match = await buildFinishedKoMatch(home, away, 1, 0, home.id)
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })

    const result = await broadcastDailyRecap(DAY)

    expect(result.total).toBe(0)
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('only a GROUP match that day → no-op (KO only)', async () => {
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Qatar').build()
    const away = await new TeamBuilder().withName('Senegal').build()
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withScheduledAt(IN_WINDOW)
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withResult(1, 0, home.id)
      .build()
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })

    const result = await broadcastDailyRecap(DAY)

    expect(result).toEqual({ total: 0, sent: 0, failed: 0, skipped: 0 })
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('no KO matches that day → no-op', async () => {
    await buildParticipant()

    const result = await broadcastDailyRecap(DAY)

    expect(result).toEqual({ total: 0, sent: 0, failed: 0, skipped: 0 })
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('send fails → failed counted, no notification recorded', async () => {
    mockSendWhatsappMessage.mockRejectedValue(new Error('Connection refused'))
    const participant = await buildParticipant()
    const home = await new TeamBuilder().withName('Nigeria').build()
    const away = await new TeamBuilder().withName('Suiza').build()
    const match = await buildFinishedKoMatch(home, away, 1, 0, home.id)
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: home.id })

    const result = await broadcastDailyRecap(DAY)

    expect(result).toEqual({ total: 1, sent: 0, failed: 1, skipped: 0 })
    const notification = await prisma.notification.findFirst({ where: { participantId: participant.id } })
    expect(notification).toBeNull()
  })

  it('invalid day → 400 INVALID_DAY', async () => {
    await expect(broadcastDailyRecap('2026-13-40')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_DAY',
    })
  })
})
