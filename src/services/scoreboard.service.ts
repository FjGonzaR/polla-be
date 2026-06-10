import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { getParam } from './scoring.service.js'
import {
  toScoreboardEntryDto,
  toScoreBreakdownDto,
  type ScoreboardEntryDto,
  type ScoreBreakdownDto,
} from '../mappers/scoreboard.mapper.js'

const SCALE_SLUG_BY_ROUND: Partial<Record<string, string>> = {
  R32: 'scale_r32', R16: 'scale_r16', QF: 'scale_qf',
  SF: 'scale_sf', THIRD: 'scale_sf', FINAL: 'scale_final',
}

async function computeProvisionalKoPoints(
  participants: { id: string }[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()

  const liveKoMatches = await prisma.match.findMany({
    where: {
      status: MatchStatus.LIVE,
      scoreHome: { not: null },
      scoreAway: { not: null },
      round: { slug: { not: RoundSlug.GROUP } },
    },
    include: { round: true },
  })

  if (liveKoMatches.length === 0) return result

  const liveMatchIds = liveKoMatches.map((m) => m.id)
  const [livePredictions, ptsAdvances, ptsExact, multTriple] = await Promise.all([
    prisma.koPrediction.findMany({ where: { matchId: { in: liveMatchIds } } }),
    getParam('pts_ko_advances'),
    getParam('pts_ko_exact_score'),
    getParam('mult_triple'),
  ])

  const uniqueSlugs = [
    ...new Set(
      liveKoMatches
        .map((m) => SCALE_SLUG_BY_ROUND[m.round.slug])
        .filter((s): s is string => s !== undefined),
    ),
  ]
  const scaleFactors = new Map<string, number>(
    await Promise.all(
      uniqueSlugs.map(async (slug) => [slug, await getParam(slug)] as [string, number]),
    ),
  )

  for (const { id: participantId } of participants) {
    let pts = 0

    for (const match of liveKoMatches) {
      if (match.scoreHome == null || match.scoreAway == null) continue
      if (match.homeTeamId == null || match.awayTeamId == null) continue

      const scaleSlug = SCALE_SLUG_BY_ROUND[match.round.slug]
      if (!scaleSlug) continue
      const scaleFactor = scaleFactors.get(scaleSlug) ?? 1

      const prediction = livePredictions.find(
        (p) => p.participantId === participantId && p.matchId === match.id,
      )
      if (!prediction) continue

      const isTie = match.scoreHome === match.scoreAway
      const provisionalWinnerId = isTie
        ? null
        : match.scoreHome > match.scoreAway
        ? match.homeTeamId
        : match.awayTeamId

      const advancesCorrect =
        provisionalWinnerId !== null && prediction.teamAdvancesId === provisionalWinnerId
      const scoreMatchesPrediction =
        prediction.scoreHome === match.scoreHome && prediction.scoreAway === match.scoreAway

      // During a tie, credit the score optimistically (advancing team TBD via penalties).
      // During a non-tie, require advances-correct too, matching final scoring logic.
      const exactCorrect = isTie ? scoreMatchesPrediction : advancesCorrect && scoreMatchesPrediction

      if (prediction.tripleActive && !exactCorrect) continue

      const scaledAdvances = advancesCorrect ? Math.round(ptsAdvances * scaleFactor) : 0
      const scaledExact = exactCorrect ? Math.round(ptsExact * scaleFactor) : 0
      const tripleBonus = exactCorrect && prediction.tripleActive ? multTriple : 0

      pts += scaledAdvances + scaledExact + tripleBonus
    }

    if (pts !== 0) result.set(participantId, pts)
  }

  return result
}

export async function getScoreboard(viewerParticipantId: string): Promise<{ updatedAt: Date; data: ScoreboardEntryDto[] }> {
  const [participants, scoreGroups, exactKoGroups] = await Promise.all([
    prisma.participant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], _sum: { points: true } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], where: { paramKey: 'pts_ko_exact_score' }, _count: { id: true } }),
  ])

  const persistedPointsMap = new Map(scoreGroups.map((g) => [g.participantId, Number(g._sum.points ?? 0)]))
  const exactKoMap = new Map(exactKoGroups.map((e) => [e.participantId, e._count.id]))

  // Provisional group points for groups not yet finalized in score_event
  const provisionalPointsMap = new Map<string, number>()
  const [allGroupStandings, finalizedGroupEvents] = await Promise.all([
    prisma.groupStanding.findMany({ where: { realPosition: { not: null } } }),
    prisma.scoreEvent.findMany({
      where: { paramKey: 'pts_group_position_exact', groupId: { not: null } },
      select: { groupId: true },
      distinct: ['groupId'],
    }),
  ])

  const finalizedGroupIds = new Set(finalizedGroupEvents.map((e) => e.groupId))
  const standingsByGroup = new Map<string, typeof allGroupStandings>()
  for (const s of allGroupStandings) {
    const arr = standingsByGroup.get(s.groupId) ?? []
    arr.push(s)
    standingsByGroup.set(s.groupId, arr)
  }

  const provisionalGroupIds = [...standingsByGroup.entries()]
    .filter(
      ([gId, stds]) =>
        !finalizedGroupIds.has(gId) &&
        stds.length === 4 &&
        stds.every((s) => s.realPosition !== null) &&
        stds.some((s) => s.matchesPlayed > 0),
    )
    .map(([gId]) => gId)

  if (provisionalGroupIds.length > 0) {
    const [ptsExact, bonusComplete, allGroupPredictions] = await Promise.all([
      getParam('pts_group_position_exact'),
      getParam('bonus_group_complete'),
      prisma.groupPrediction.findMany({ where: { groupId: { in: provisionalGroupIds } } }),
    ])

    for (const { id: participantId } of participants) {
      let pts = 0
      for (const groupId of provisionalGroupIds) {
        const stds = standingsByGroup.get(groupId)!
        const groupPreds = allGroupPredictions.filter((p) => p.participantId === participantId && p.groupId === groupId)
        if (groupPreds.length !== 4) continue
        const exactCount = groupPreds.filter(
          (p) => stds.find((s) => s.teamId === p.teamId)?.realPosition === p.predictedPosition,
        ).length
        pts += exactCount * ptsExact
        if (exactCount === 4) pts += bonusComplete
      }
      if (pts > 0) provisionalPointsMap.set(participantId, pts)
    }
  }

  const provisionalKoPointsMap = await computeProvisionalKoPoints(participants)

  const pointsMap = new Map(
    participants.map((p) => [
      p.id,
      (persistedPointsMap.get(p.id) ?? 0) +
        (provisionalPointsMap.get(p.id) ?? 0) +
        (provisionalKoPointsMap.get(p.id) ?? 0),
    ]),
  )

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

  const top10 = data.slice(0, 10)
  const viewerInTop10 = top10.some((e) => e.participant.id === viewerParticipantId)
  if (!viewerInTop10) {
    const viewerEntry = data.find((e) => e.participant.id === viewerParticipantId)
    if (viewerEntry) top10.push(viewerEntry)
  }

  return { updatedAt: new Date(), data: top10 }
}

export async function getScoreboardBreakdown(participantId: string): Promise<ScoreBreakdownDto> {
  const [participant, events, tripleCount, scoreboard] = await Promise.all([
    prisma.participant.findUnique({ where: { id: participantId }, select: { id: true, name: true } }),
    prisma.scoreEvent.findMany({ where: { participantId }, select: { paramKey: true, points: true } }),
    prisma.koPrediction.count({ where: { participantId, tripleActive: true } }),
    getScoreboard(participantId),
  ])

  if (!participant) throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found')

  const prize = scoreboard.data.find((e) => e.participant.id === participantId)?.prize ?? null

  return toScoreBreakdownDto(participant, events, Math.max(0, 3 - tripleCount), prize)
}
