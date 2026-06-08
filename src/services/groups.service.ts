import type { Group, GroupPrediction, GroupStanding, Team } from '@prisma/client'
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
  flag: string | null
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

type LedgerGroupEntry = { pts_group_position_exact: number; bonus_group_complete: number }
type LedgerGroupMap = Map<string, LedgerGroupEntry>

function computeGroupStatus(
  groups: (Group & { teams: Team[] })[],
  predictions: (GroupPrediction & { team: Team })[],
  allStandings: GroupStanding[],
  ptsExact: number,
  bonusComplete: number,
  ledgerByGroup: LedgerGroupMap = new Map(),
): MyGroupPredictionsDto {
  const data: GroupPredictionStatus[] = groups.map((group) => {
    const groupPreds = predictions
      .filter((p) => p.groupId === group.id)
      .sort((a, b) => a.predictedPosition - b.predictedPosition)

    const groupComplete = groupPreds.length === 4
    const rankings: RankingDto[] = groupPreds.map((p) => ({
      teamId: p.teamId,
      name: p.team.name,
      code: p.team.code,
      isTop8: p.team.isTop8,
      flag: p.team.flag,
      predictedPosition: p.predictedPosition,
    }))

    let pointsEarned: PointsEarned | null = null
    if (groupComplete) {
      const ledger = ledgerByGroup.get(group.id)
      if (ledger) {
        pointsEarned = {
          pts_group_position_exact: ledger.pts_group_position_exact,
          bonus_group_complete: ledger.bonus_group_complete,
          total: ledger.pts_group_position_exact + ledger.bonus_group_complete,
        }
      } else {
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
    }

    return { groupId: group.id, label: group.label, name: group.name, groupComplete, rankings, pointsEarned }
  })

  return { data, completedGroups: data.filter((g) => g.groupComplete).length }
}

function buildLedgerGroupMap(
  events: { paramKey: string; points: number; groupId: string | null }[],
): LedgerGroupMap {
  const map: LedgerGroupMap = new Map()
  for (const e of events) {
    if (!e.groupId) continue
    const curr = map.get(e.groupId) ?? { pts_group_position_exact: 0, bonus_group_complete: 0 }
    if (e.paramKey === 'pts_group_position_exact') curr.pts_group_position_exact += e.points
    if (e.paramKey === 'bonus_group_complete') curr.bonus_group_complete += e.points
    map.set(e.groupId, curr)
  }
  return map
}

export async function findMyGroupPredictions(participantId: string): Promise<MyGroupPredictionsDto> {
  const [groups, predictions, allStandings] = await Promise.all([
    prisma.group.findMany({ include: { teams: true }, orderBy: { label: 'asc' } }),
    prisma.groupPrediction.findMany({ where: { participantId }, include: { team: true } }),
    prisma.groupStanding.findMany(),
  ])

  const groupIds = groups.map((g) => g.id)
  const ledgerEvents = await prisma.scoreEvent.findMany({
    where: {
      participantId,
      groupId: { in: groupIds },
      paramKey: { in: ['pts_group_position_exact', 'bonus_group_complete'] },
    },
    select: { paramKey: true, points: true, groupId: true },
  })
  const ledgerByGroup = buildLedgerGroupMap(ledgerEvents)

  const hasAnyComplete = groups.some((g) => predictions.filter((p) => p.groupId === g.id).length === 4)
  const [ptsExact, bonusComplete] = hasAnyComplete
    ? await Promise.all([getParam('pts_group_position_exact'), getParam('bonus_group_complete')])
    : [0, 0]

  return computeGroupStatus(groups, predictions, allStandings, ptsExact, bonusComplete, ledgerByGroup)
}

interface FriendPrediction {
  participant: { id: string; name: string }
  predictions: GroupPredictionStatus[]
  totalGroupPoints: number
}

type FriendsGroupPredictionsDto =
  | { available: false; availableAt: Date | null }
  | { available: true; data: FriendPrediction[] }

export async function findFriendsGroupPredictions(
  participantId: string,
  friendId?: string,
): Promise<FriendsGroupPredictionsDto> {
  if (friendId) {
    if (friendId === participantId) {
      throw new AppError(400, 'INVALID_FRIEND', 'Cannot request predictions for yourself')
    }
    const friend = await prisma.participant.findUnique({ where: { id: friendId }, select: { id: true } })
    if (!friend) throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found')
  }

  const firstMatch = await prisma.match.findFirst({ orderBy: { scheduledAt: 'asc' } })
  if (!firstMatch || firstMatch.scheduledAt > new Date()) {
    return { available: false, availableAt: firstMatch?.scheduledAt ?? null }
  }

  const others = await prisma.participant.findMany({
    where: friendId ? { id: friendId } : { id: { not: participantId } },
  })
  const otherIds = others.map((p) => p.id)

  const [groups, allStandings, allPredictions, allLedgerEvents, ptsExact, bonusComplete] =
    await Promise.all([
      prisma.group.findMany({ include: { teams: true }, orderBy: { label: 'asc' } }),
      prisma.groupStanding.findMany(),
      prisma.groupPrediction.findMany({
        where: { participantId: { in: otherIds } },
        include: { team: true },
      }),
      prisma.scoreEvent.findMany({
        where: {
          participantId: { in: otherIds },
          paramKey: { in: ['pts_group_position_exact', 'bonus_group_complete'] },
        },
        select: { participantId: true, paramKey: true, points: true, groupId: true },
      }),
      getParam('pts_group_position_exact'),
      getParam('bonus_group_complete'),
    ])

  // Map participantId → LedgerGroupMap
  const participantLedger = new Map<string, LedgerGroupMap>()
  for (const e of allLedgerEvents) {
    if (!participantLedger.has(e.participantId)) participantLedger.set(e.participantId, new Map())
    const gMap = participantLedger.get(e.participantId)!
    const curr = gMap.get(e.groupId ?? '') ?? { pts_group_position_exact: 0, bonus_group_complete: 0 }
    if (e.paramKey === 'pts_group_position_exact') curr.pts_group_position_exact += e.points
    if (e.paramKey === 'bonus_group_complete') curr.bonus_group_complete += e.points
    if (e.groupId) gMap.set(e.groupId, curr)
  }

  const data: FriendPrediction[] = others.map((p) => {
    const predictions = allPredictions.filter((pred) => pred.participantId === p.id)
    const ledgerByGroup = participantLedger.get(p.id) ?? new Map()
    const { data: groupData } = computeGroupStatus(
      groups,
      predictions,
      allStandings,
      ptsExact,
      bonusComplete,
      ledgerByGroup,
    )
    const totalGroupPoints = groupData.reduce((sum, g) => sum + (g.pointsEarned?.total ?? 0), 0)
    return { participant: { id: p.id, name: p.name }, predictions: groupData, totalGroupPoints }
  })

  return { available: true, data }
}
