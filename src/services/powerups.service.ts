import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { isGroupPhaseLocked } from '../lib/lock.js'
import {
  toMyPowerupsDto,
  toFriendPowerupsDto,
  type MyPowerupsDto,
  type FriendPowerupsDto,
} from '../mappers/powerup.mapper.js'

const INCLUDE_TEAMS = {
  darkHorseTeam: true,
  disappointmentTeam: true,
} as const

async function validateTeams(darkHorseTeamId: string, disappointmentTeamId: string) {
  const [darkHorse, disappointment] = await Promise.all([
    prisma.team.findUnique({ where: { id: darkHorseTeamId } }),
    prisma.team.findUnique({ where: { id: disappointmentTeamId } }),
  ])

  if (!darkHorse || darkHorse.isTop8) {
    throw new AppError(400, 'INVALID_DARK_HORSE', 'Dark horse must be a non-top-8 team')
  }
  if (!disappointment || !disappointment.isTop8) {
    throw new AppError(400, 'INVALID_DISAPPOINTMENT', 'Disappointment must be a top-8 team')
  }
}

export async function createPowerups(
  participantId: string,
  darkHorseTeamId: string,
  disappointmentTeamId: string,
): Promise<MyPowerupsDto> {
  if (await isGroupPhaseLocked()) {
    throw new AppError(423, 'PREDICTIONS_LOCKED', 'Predictions are locked')
  }

  await validateTeams(darkHorseTeamId, disappointmentTeamId)

  const existing = await prisma.powerup.findUnique({ where: { participantId } })
  if (existing) {
    throw new AppError(409, 'POWERUPS_ALREADY_EXISTS', 'Powerups already exist, use PUT to update')
  }

  const powerup = await prisma.powerup.create({
    data: { participantId, darkHorseTeamId, disappointmentTeamId },
    include: INCLUDE_TEAMS,
  })

  return toMyPowerupsDto(powerup)
}

export async function updatePowerups(
  participantId: string,
  darkHorseTeamId: string,
  disappointmentTeamId: string,
): Promise<MyPowerupsDto> {
  if (await isGroupPhaseLocked()) {
    throw new AppError(423, 'PREDICTIONS_LOCKED', 'Predictions are locked')
  }

  await validateTeams(darkHorseTeamId, disappointmentTeamId)

  const existing = await prisma.powerup.findUnique({ where: { participantId } })
  if (!existing) {
    throw new AppError(404, 'POWERUPS_NOT_FOUND', 'Powerups not found, use POST to create')
  }

  const powerup = await prisma.powerup.update({
    where: { participantId },
    data: { darkHorseTeamId, disappointmentTeamId },
    include: INCLUDE_TEAMS,
  })

  return toMyPowerupsDto(powerup)
}

export async function findMyPowerups(participantId: string): Promise<MyPowerupsDto> {
  const powerup = await prisma.powerup.findUnique({
    where: { participantId },
    include: INCLUDE_TEAMS,
  })
  return toMyPowerupsDto(powerup)
}

type FriendsPowerupsResult =
  | { available: false; availableAt: Date | null; data: null }
  | { available: true; availableAt: null; data: FriendPowerupsDto[] }

export async function findFriendsPowerups(participantId: string): Promise<FriendsPowerupsResult> {
  const firstMatch = await prisma.match.findFirst({ orderBy: { scheduledAt: 'asc' } })
  if (!firstMatch || firstMatch.scheduledAt > new Date()) {
    return { available: false, availableAt: firstMatch?.scheduledAt ?? null, data: null }
  }

  const others = await prisma.participant.findMany({ where: { id: { not: participantId } } })
  const powerups = await prisma.powerup.findMany({
    where: { participantId: { in: others.map((p) => p.id) } },
    include: INCLUDE_TEAMS,
  })

  const powerupByParticipant = new Map(powerups.map((p) => [p.participantId, p]))

  const data = others.map((p) =>
    toFriendPowerupsDto(p, powerupByParticipant.get(p.id) ?? null),
  )

  return { available: true, availableAt: null, data }
}
