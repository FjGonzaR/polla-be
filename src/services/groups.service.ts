import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { toGroupDto, type GroupDto } from '../mappers/group.mapper.js'

export async function findAllGroups(): Promise<GroupDto[]> {
  const groups = await prisma.group.findMany({
    include: { teams: true },
    orderBy: { label: 'asc' },
  })
  return groups.map(toGroupDto)
}

interface GroupPredictionInput {
  groupId: string
  rankings: Array<{ teamId: string; position: number }>
}

export async function upsertGroupPredictions(
  participantId: string,
  predictions: GroupPredictionInput[],
): Promise<{ savedGroups: number }> {
  for (const { groupId, rankings } of predictions) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { teams: true },
    })
    if (!group) {
      throw new AppError(400, 'GROUP_NOT_FOUND', `Grupo ${groupId} no encontrado`)
    }

    if (rankings.length !== 4) {
      throw new AppError(400, 'INVALID_RANKINGS', 'Debes enviar exactamente 4 posiciones')
    }

    const groupTeamIds = new Set(group.teams.map((t) => t.id))
    for (const { teamId } of rankings) {
      if (!groupTeamIds.has(teamId)) {
        throw new AppError(400, 'INVALID_RANKINGS', `Equipo ${teamId} no pertenece al grupo`)
      }
    }

    const sorted = rankings.map((r) => r.position).sort((a, b) => a - b)
    if (sorted.join() !== '1,2,3,4') {
      throw new AppError(400, 'INVALID_RANKINGS', 'Posiciones inválidas o duplicadas')
    }

    await prisma.$transaction([
      prisma.groupPrediction.deleteMany({ where: { participantId, groupId } }),
      prisma.groupPrediction.createMany({
        data: rankings.map((r) => ({
          participantId,
          groupId,
          teamId: r.teamId,
          predictedPosition: r.position,
        })),
      }),
    ])
  }

  return { savedGroups: predictions.length }
}
