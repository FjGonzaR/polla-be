import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import {
  toScoreboardEntryDto,
  toScoreBreakdownDto,
  type ScoreboardEntryDto,
  type ScoreBreakdownDto,
} from '../mappers/scoreboard.mapper.js'

export async function getScoreboard(): Promise<{ updatedAt: Date; data: ScoreboardEntryDto[] }> {
  const [participants, scoreGroups, exactKoGroups] = await Promise.all([
    prisma.participant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], _sum: { points: true } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], where: { paramKey: 'pts_ko_exact_score' }, _count: { id: true } }),
  ])

  const pointsMap = new Map(scoreGroups.map((g) => [g.participantId, g._sum.points ?? 0]))
  const exactKoMap = new Map(exactKoGroups.map((e) => [e.participantId, e._count.id]))

  function compareByScoreThenExact(a: { id: string }, b: { id: string }): number {
    const ptsDiff = Number(pointsMap.get(b.id) ?? 0) - Number(pointsMap.get(a.id) ?? 0)
    if (ptsDiff !== 0) return ptsDiff
    return (exactKoMap.get(b.id) ?? 0) - (exactKoMap.get(a.id) ?? 0)
  }

  const sorted = [...participants].sort(compareByScoreThenExact)

  const ranks: number[] = []
  let rank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      const samePts = Number(pointsMap.get(prev.id) ?? 0) === Number(pointsMap.get(curr.id) ?? 0)
      const sameExact = (exactKoMap.get(prev.id) ?? 0) === (exactKoMap.get(curr.id) ?? 0)
      if (!samePts || !sameExact) rank = i + 1
    }
    ranks.push(rank)
  }

  const rankGroupSize = new Map<number, number>()
  for (const r of ranks) {
    rankGroupSize.set(r, (rankGroupSize.get(r) ?? 0) + 1)
  }

  const data: ScoreboardEntryDto[] = sorted.map((p, i) => {
    const r = ranks[i]
    return toScoreboardEntryDto(r, rankGroupSize.get(r) ?? 1, p, Number(pointsMap.get(p.id) ?? 0))
  })

  return { updatedAt: new Date(), data: data.slice(0, 10) }
}

export async function getScoreboardBreakdown(participantId: string): Promise<ScoreBreakdownDto> {
  const [participant, events, tripleCount, scoreboard] = await Promise.all([
    prisma.participant.findUnique({ where: { id: participantId }, select: { id: true, name: true } }),
    prisma.scoreEvent.findMany({ where: { participantId }, select: { paramKey: true, points: true } }),
    prisma.koPrediction.count({ where: { participantId, tripleActive: true } }),
    getScoreboard(),
  ])

  if (!participant) throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found')

  const prize = scoreboard.data.find((e) => e.participant.id === participantId)?.prize ?? null

  return toScoreBreakdownDto(participant, events, Math.max(0, 3 - tripleCount), prize)
}
