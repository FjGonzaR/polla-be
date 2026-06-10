import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { sendGroupPhaseReminder } from '../../crons/group-phase-reminder.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn(),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
}))

async function buildCompleteGroupPhase(participantId: string) {
  const groupPreds: { participantId: string; groupId: string; teamId: string; predictedPosition: number }[] = []
  const thirdCandidateTeamIds: string[] = []
  let darkHorseTeamId: string | null = null
  let disappointmentTeamId: string | null = null

  for (let g = 0; g < 12; g++) {
    const label = String.fromCharCode(65 + g) // A–L
    const group = await new GroupBuilder().withLabel(label).withName(`Group ${label}`).build()
    const teams = await Promise.all([
      new TeamBuilder().withName(`${label}1`).withCode(`${label}1`).withGroupId(group.id).withIsTop8(false).build(),
      new TeamBuilder().withName(`${label}2`).withCode(`${label}2`).withGroupId(group.id).withIsTop8(true).build(),
      new TeamBuilder().withName(`${label}3`).withCode(`${label}3`).withGroupId(group.id).withIsTop8(false).build(),
      new TeamBuilder().withName(`${label}4`).withCode(`${label}4`).withGroupId(group.id).withIsTop8(false).build(),
    ])
    teams.forEach((team, i) => {
      groupPreds.push({ participantId, groupId: group.id, teamId: team.id, predictedPosition: i + 1 })
    })
    thirdCandidateTeamIds.push(teams[2].id)
    if (g === 0) {
      darkHorseTeamId = teams[0].id  // isTop8: false
      disappointmentTeamId = teams[1].id  // isTop8: true
    }
  }

  await prisma.groupPrediction.createMany({ data: groupPreds })

  await prisma.thirdPrediction.createMany({
    data: thirdCandidateTeamIds.slice(0, 8).map((teamId) => ({ participantId, teamId })),
  })

  await prisma.powerup.create({
    data: { participantId, darkHorseTeamId: darkHorseTeamId!, disappointmentTeamId: disappointmentTeamId! },
  })
}

describe('sendGroupPhaseReminder', () => {
  beforeEach(() => {
    mockSendWhatsappMessage.mockReset()
    mockSendWhatsappMessage.mockResolvedValue(undefined)
  })

  it('no participants → resolves without error, 0 messages sent', async () => {
    await sendGroupPhaseReminder()
    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('participant without phone (hasPhone=false) → no message sent', async () => {
    await buildParticipant({ hasPhone: false, phone: null, invitationId: null, role: 'ADMIN' })

    await sendGroupPhaseReminder()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('participant with phone but missing group predictions → message sent', async () => {
    const participant = await buildParticipant({ hasPhone: true, phone: '+573001234567' })

    await sendGroupPhaseReminder()

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('Polla Mundial 2026'),
    )
  })

  it('participant with all predictions complete → no message sent', async () => {
    const participant = await buildParticipant({ hasPhone: true, phone: '+573001234567' })
    await buildCompleteGroupPhase(participant.id)

    await sendGroupPhaseReminder()

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('mixed participants: only incomplete ones receive message', async () => {
    const incomplete = await buildParticipant({ hasPhone: true, phone: '+573001111111' })
    const complete = await buildParticipant({ hasPhone: true, phone: '+573002222222' })
    await buildCompleteGroupPhase(complete.id)

    await sendGroupPhaseReminder()

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(incomplete.phone, expect.any(String))
  })
})
