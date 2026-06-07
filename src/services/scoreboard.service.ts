import { prisma } from '../lib/prisma.js'
import { toScoreboardEntryDto, type ScoreboardEntryDto } from '../mappers/scoreboard.mapper.js'

export async function getScoreboard(): Promise<ScoreboardEntryDto[]> {
  const [participants, scoreGroups, koPredictions] = await Promise.all([
    prisma.participant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], _sum: { points: true } }),
    prisma.koPrediction.findMany({ include: { match: { select: { scoreHome: true, scoreAway: true } } } }),
  ])

  const pointsMap = new Map(scoreGroups.map((g) => [g.participantId, g._sum.points ?? 0]))

  const exactKoMap = new Map<string, number>()
  for (const p of koPredictions) {
    if (
      p.match.scoreHome !== null &&
      p.match.scoreAway !== null &&
      p.scoreHome === p.match.scoreHome &&
      p.scoreAway === p.match.scoreAway
    ) {
      exactKoMap.set(p.participantId, (exactKoMap.get(p.participantId) ?? 0) + 1)
    }
  }

  const sorted = [...participants].sort((a, b) => {
    const ptsDiff = (pointsMap.get(b.id) ?? 0) - (pointsMap.get(a.id) ?? 0)
    if (ptsDiff !== 0) return ptsDiff
    return (exactKoMap.get(b.id) ?? 0) - (exactKoMap.get(a.id) ?? 0)
  })

  const entries: ScoreboardEntryDto[] = []
  let rank = 1

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      const samePts = (pointsMap.get(prev.id) ?? 0) === (pointsMap.get(curr.id) ?? 0)
      const sameExact = (exactKoMap.get(prev.id) ?? 0) === (exactKoMap.get(curr.id) ?? 0)
      if (!samePts || !sameExact) rank = i + 1
    }

    const p = sorted[i]
    entries.push(
      toScoreboardEntryDto(rank, p, pointsMap.get(p.id) ?? 0, exactKoMap.get(p.id) ?? 0),
    )
  }

  return entries
}
