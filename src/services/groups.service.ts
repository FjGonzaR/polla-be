import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { toGroupDto, type GroupDto } from '../mappers/group.mapper.js'
import { getParam } from './scoring.service.js'

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

interface RankingDto {
  teamId: string
  name: string
  code: string
  isTop8: boolean
  predictedPosition: number
}

interface PointsEarned {
  pts_group_position_exact: number
  bonus_group_complete: number
  total: number
}

interface GroupPredictionStatus {
  groupId: string
  label: string
  name: string
  groupComplete: boolean
  rankings: RankingDto[]
  pointsEarned: PointsEarned | null
}

interface MyGroupPredictionsDto {
  data: GroupPredictionStatus[]
  completedGroups: number
}

export async function findMyGroupPredictions(participantId: string): Promise<MyGroupPredictionsDto> {
  const [groups, allPredictions, allStandings] = await Promise.all([
    prisma.group.findMany({ include: { teams: true }, orderBy: { label: 'asc' } }),
    prisma.groupPrediction.findMany({ where: { participantId }, include: { team: true } }),
    prisma.groupStanding.findMany(),
  ])

  const hasAnyComplete = groups.some(
    (g) => allPredictions.filter((p) => p.groupId === g.id).length === 4,
  )
  const [ptsExact, bonusComplete] = hasAnyComplete
    ? await Promise.all([getParam('pts_group_position_exact'), getParam('bonus_group_complete')])
    : [0, 0]

  const data: GroupPredictionStatus[] = groups.map((group) => {
    const predictions = allPredictions
      .filter((p) => p.groupId === group.id)
      .sort((a, b) => a.predictedPosition - b.predictedPosition)

    const groupComplete = predictions.length === 4
    const rankings: RankingDto[] = predictions.map((p) => ({
      teamId: p.teamId,
      name: p.team.name,
      code: p.team.code,
      isTop8: p.team.isTop8,
      predictedPosition: p.predictedPosition,
    }))

    let pointsEarned: PointsEarned | null = null
    if (groupComplete) {
      const standings = allStandings.filter((s) => s.groupId === group.id)
      if (standings.length === 4 && standings.every((s) => s.realPosition !== null)) {
        const exactCount = rankings.filter(
          (r) => standings.find((s) => s.teamId === r.teamId)?.realPosition === r.predictedPosition,
        ).length
        const pts = exactCount * ptsExact
        const bonus = exactCount === 4 ? bonusComplete : 0
        pointsEarned = { pts_group_position_exact: pts, bonus_group_complete: bonus, total: pts + bonus }
      }
    }

    return { groupId: group.id, label: group.label, name: group.name, groupComplete, rankings, pointsEarned }
  })

  return { data, completedGroups: data.filter((g) => g.groupComplete).length }
}
