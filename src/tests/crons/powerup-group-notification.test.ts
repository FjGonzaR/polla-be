import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { sendPowerupGroupNotifications } from '../../crons/powerup-group-notification.js'

const { mockSendWhatsappMessage } = vi.hoisted(() => ({
  mockSendWhatsappMessage: vi.fn(),
}))

vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: mockSendWhatsappMessage,
}))

async function buildGroupWithStanding(
  label: string,
  teamName: string,
  realPosition: number | null,
) {
  const group = await prisma.group.create({
    data: { name: `Group ${label}`, label },
  })
  const team = await prisma.team.create({
    data: { name: teamName, code: teamName.slice(0, 3).toUpperCase(), groupId: group.id },
  })
  if (realPosition !== null) {
    await prisma.groupStanding.create({
      data: { teamId: team.id, groupId: group.id, realPosition, matchesPlayed: 3, pts: 3 },
    })
  }
  return { group, team }
}

async function buildPowerupForParticipant(
  participantId: string,
  darkHorseTeamId: string,
  opts: { darkHorseGroupNotifiedAt?: Date } = {},
) {
  const group = await prisma.group.create({
    data: { name: 'Disappointment Group', label: 'Z' },
  })
  const disappointmentTeam = await prisma.team.create({
    data: { name: 'Top Team', code: 'TOP', isTop8: true, groupId: group.id },
  })
  return prisma.powerup.create({
    data: {
      participantId,
      darkHorseTeamId,
      disappointmentTeamId: disappointmentTeam.id,
      darkHorseGroupNotifiedAt: opts.darkHorseGroupNotifiedAt ?? null,
    },
  })
}

describe('sendPowerupGroupNotifications', () => {
  beforeEach(() => {
    mockSendWhatsappMessage.mockReset()
    mockSendWhatsappMessage.mockResolvedValue(undefined)
  })

  it('dark horse finishes 1st → sends message and sets darkHorseGroupNotifiedAt', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('A', 'Honduras', 1)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('¡Tu promesa está brillando!'),
    )
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('1° en el Grupo A'),
    )

    const updated = await prisma.powerup.findFirst({ where: { participantId: participant.id } })
    expect(updated!.darkHorseGroupNotifiedAt).not.toBeNull()
  })

  it('dark horse finishes 2nd → sends 2nd-place message', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('B', 'Bolivia', 2)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('¡Tu promesa clasificó!'),
    )
  })

  it('dark horse finishes 3rd → sends pending message', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('C', 'Cameroon', 3)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('Tu promesa terminó tercero...'),
    )
  })

  it('dark horse finishes 4th → sends bad news message', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('D', 'Denmark', 4)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).toHaveBeenCalledOnce()
    expect(mockSendWhatsappMessage).toHaveBeenCalledWith(
      participant.phone,
      expect.stringContaining('Tu promesa no pudo ser.'),
    )
  })

  it('darkHorseGroupNotifiedAt already set → no re-send', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('E', 'Estonia', 1)
    await buildPowerupForParticipant(participant.id, team.id, { darkHorseGroupNotifiedAt: new Date() })

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('participant has hasPhone=false → skip', async () => {
    const participant = await buildParticipant({ hasPhone: false, phone: null })
    const { group, team } = await buildGroupWithStanding('F', 'Finland', 1)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
    const powerup = await prisma.powerup.findFirst({ where: { participantId: participant.id } })
    expect(powerup!.darkHorseGroupNotifiedAt).toBeNull()
  })

  it('standing has realPosition=null → skip', async () => {
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('G', 'Georgia', null)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('send fails → logs error, darkHorseGroupNotifiedAt stays null', async () => {
    mockSendWhatsappMessage.mockRejectedValue(new Error('Connection refused'))
    const participant = await buildParticipant()
    const { group, team } = await buildGroupWithStanding('H', 'Hungary', 2)
    await buildPowerupForParticipant(participant.id, team.id)

    await sendPowerupGroupNotifications(group.id)

    const powerup = await prisma.powerup.findFirst({ where: { participantId: participant.id } })
    expect(powerup!.darkHorseGroupNotifiedAt).toBeNull()
  })

  it('no powerup with dark horse in this group → no-op', async () => {
    const { group } = await buildGroupWithStanding('I', 'Iceland', 1)

    await sendPowerupGroupNotifications(group.id)

    expect(mockSendWhatsappMessage).not.toHaveBeenCalled()
  })
})
