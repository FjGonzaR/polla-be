import type { RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { getParam } from './scoring.service.js'

const KO_ROUND_SLUGS: RoundSlug[] = ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL']

const SCALE_SLUG_MAP: Partial<Record<RoundSlug, string>> = {
  R32: 'scale_r32',
  R16: 'scale_r16',
  QF: 'scale_qf',
  SF: 'scale_sf',
  THIRD: 'scale_sf',
  FINAL: 'scale_final',
}

interface ScoreEventInput {
  participantId: string
  paramKey: string
  matchId: string | null
  groupId: string | null
  roundSlug: RoundSlug | null
  points: number
}

async function buildGroupEvents(participantId: string): Promise<ScoreEventInput[]> {
  const [groups, predictions, standings, ptsExact, bonusComplete] = await Promise.all([
    prisma.group.findMany({ include: { teams: true } }),
    prisma.groupPrediction.findMany({ where: { participantId } }),
    prisma.groupStanding.findMany(),
    getParam('pts_group_position_exact'),
    getParam('bonus_group_complete'),
  ])

  const events: ScoreEventInput[] = []

  for (const group of groups) {
    const groupPreds = predictions.filter((p) => p.groupId === group.id)
    if (groupPreds.length !== 4) continue

    const groupStandings = standings.filter((s) => s.groupId === group.id)
    if (groupStandings.length !== 4 || groupStandings.some((s) => s.realPosition === null || s.matchesPlayed === 0)) continue

    const exactCount = groupPreds.filter(
      (p) => groupStandings.find((s) => s.teamId === p.teamId)?.realPosition === p.predictedPosition,
    ).length

    const pts = exactCount * ptsExact
    if (pts > 0) {
      events.push({ participantId, paramKey: 'pts_group_position_exact', matchId: null, groupId: group.id, roundSlug: null, points: pts })
    }

    if (exactCount === 4 && bonusComplete > 0) {
      events.push({ participantId, paramKey: 'bonus_group_complete', matchId: null, groupId: group.id, roundSlug: null, points: bonusComplete })
    }
  }

  return events
}

async function buildThirdEvents(participantId: string): Promise<ScoreEventInput[]> {
  const [thirdPredictions, ptsThird] = await Promise.all([
    prisma.thirdPrediction.findMany({ where: { participantId } }),
    getParam('pts_third_correct'),
  ])

  if (thirdPredictions.length === 0) return []

  const teamIds = thirdPredictions.map((t) => t.teamId)
  const standings = await prisma.groupStanding.findMany({
    where: { teamId: { in: teamIds }, qualifiedAsThird: true },
  })

  return standings.map((s) => ({
    participantId,
    paramKey: 'pts_third_correct',
    matchId: null,
    groupId: null,
    roundSlug: null,
    points: ptsThird,
  }))
}

async function buildKoEvents(participantId: string): Promise<ScoreEventInput[]> {
  const [predictions, ptsAdvances, ptsExact, multTriple] = await Promise.all([
    prisma.koPrediction.findMany({
      where: { participantId },
      include: { match: { include: { round: true } } },
    }),
    getParam('pts_ko_advances'),
    getParam('pts_ko_exact_score'),
    getParam('mult_triple'),
  ])

  const events: ScoreEventInput[] = []

  for (const prediction of predictions) {
    const { match } = prediction
    if (match.scoreHome == null || match.scoreAway == null || match.winnerTeamId == null) continue

    const roundSlug = match.round.slug
    const scaleSlug = SCALE_SLUG_MAP[roundSlug]
    if (!scaleSlug) continue

    const scaleFactor = await getParam(scaleSlug)

    const advancesCorrect = prediction.teamAdvancesId === match.winnerTeamId
    const exactCorrect =
      advancesCorrect &&
      prediction.scoreHome === match.scoreHome &&
      prediction.scoreAway === match.scoreAway

    if (prediction.tripleActive && !exactCorrect) continue

    const earnedAdvances = advancesCorrect ? ptsAdvances : 0
    const earnedExact = exactCorrect ? ptsExact : 0
    const tripleBonus = exactCorrect && prediction.tripleActive ? multTriple : 0
    const scaledTotal = Math.round((earnedAdvances + earnedExact) * scaleFactor)

    if (earnedAdvances > 0 || scaledTotal > 0) {
      const scaledAdvances = Math.round(earnedAdvances * scaleFactor)
      const scaledExact = Math.round(earnedExact * scaleFactor)

      if (scaledAdvances > 0) {
        events.push({ participantId, paramKey: 'pts_ko_advances', matchId: match.id, groupId: null, roundSlug, points: scaledAdvances })
      }
      if (scaledExact > 0) {
        events.push({ participantId, paramKey: 'pts_ko_exact_score', matchId: match.id, groupId: null, roundSlug, points: scaledExact })
      }
    }

    if (tripleBonus > 0) {
      events.push({ participantId, paramKey: 'mult_triple', matchId: match.id, groupId: null, roundSlug, points: tripleBonus })
    }
  }

  return events
}

async function buildPowerupEvents(participantId: string): Promise<ScoreEventInput[]> {
  const powerup = await prisma.powerup.findUnique({ where: { participantId } })
  if (!powerup) return []

  const [ptsDarkHorse, ptsDisappointment] = await Promise.all([
    getParam('pts_dark_horse_per_round'),
    getParam('pts_disappointment_per_round'),
  ])

  const koMatches = await prisma.match.findMany({
    where: {
      winnerTeamId: { in: [powerup.darkHorseTeamId, powerup.disappointmentTeamId] },
      round: { slug: { in: KO_ROUND_SLUGS } },
    },
    include: { round: true },
  })

  const events: ScoreEventInput[] = []

  for (const match of koMatches) {
    const roundSlug = match.round.slug
    const scaleSlug = SCALE_SLUG_MAP[roundSlug]
    if (!scaleSlug) continue
    const scaleFactor = await getParam(scaleSlug)

    if (match.winnerTeamId === powerup.darkHorseTeamId && ptsDarkHorse > 0) {
      events.push({ participantId, paramKey: 'pts_dark_horse_per_round', matchId: match.id, groupId: null, roundSlug, points: Math.round(ptsDarkHorse * scaleFactor) })
    }

    if (match.winnerTeamId === powerup.disappointmentTeamId) {
      events.push({ participantId, paramKey: 'pts_disappointment_per_round', matchId: match.id, groupId: null, roundSlug, points: -Math.round(ptsDisappointment * scaleFactor) })
    }
  }

  return events
}

// ─── Incremental persistence (called from crons after each result) ───────────

export function isGroupFinalized(
  group: { lastMatchAt: Date | null },
  standings: { matchesPlayed: number }[],
): boolean {
  if (!group.lastMatchAt) return false
  const twoHoursAfter = new Date(group.lastMatchAt.getTime() + 2 * 60 * 60 * 1000)
  if (new Date() < twoHoursAfter) return false
  return standings.length === 4 && standings.every((s) => s.matchesPlayed === 3)
}

export async function persistGroupScoreEvents(groupId: string): Promise<void> {
  const [ptsExact, bonusComplete, participants, standings] = await Promise.all([
    getParam('pts_group_position_exact'),
    getParam('bonus_group_complete'),
    prisma.participant.findMany({ select: { id: true } }),
    prisma.groupStanding.findMany({ where: { groupId } }),
  ])

  if (standings.length !== 4 || standings.some((s) => s.realPosition === null || s.matchesPlayed === 0)) return

  const allPredictions = await prisma.groupPrediction.findMany({
    where: { groupId, participantId: { in: participants.map((p) => p.id) } },
  })

  const events: ScoreEventInput[] = []

  for (const { id: participantId } of participants) {
    const groupPreds = allPredictions.filter((p) => p.participantId === participantId)
    if (groupPreds.length !== 4) continue

    const exactCount = groupPreds.filter(
      (p) => standings.find((s) => s.teamId === p.teamId)?.realPosition === p.predictedPosition,
    ).length

    const pts = exactCount * ptsExact
    if (pts > 0) {
      events.push({ participantId, paramKey: 'pts_group_position_exact', matchId: null, groupId, roundSlug: null, points: pts })
    }
    if (exactCount === 4 && bonusComplete > 0) {
      events.push({ participantId, paramKey: 'bonus_group_complete', matchId: null, groupId, roundSlug: null, points: bonusComplete })
    }
  }

  await prisma.$transaction([
    prisma.scoreEvent.deleteMany({ where: { groupId } }),
    prisma.scoreEvent.createMany({ data: events }),
  ])
}

export async function persistKoMatchScoreEvents(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({ where: { id: matchId }, include: { round: true } })
  if (!match || match.scoreHome == null || match.scoreAway == null || match.winnerTeamId == null) return

  const roundSlug = match.round.slug
  const scaleSlug = SCALE_SLUG_MAP[roundSlug]
  if (!scaleSlug) return

  const [ptsAdvances, ptsExact, multTriple, scaleFactor, predictions] = await Promise.all([
    getParam('pts_ko_advances'),
    getParam('pts_ko_exact_score'),
    getParam('mult_triple'),
    getParam(scaleSlug),
    prisma.koPrediction.findMany({ where: { matchId } }),
  ])

  const events: ScoreEventInput[] = []

  for (const prediction of predictions) {
    const advancesCorrect = prediction.teamAdvancesId === match.winnerTeamId
    const exactCorrect =
      advancesCorrect &&
      prediction.scoreHome === match.scoreHome &&
      prediction.scoreAway === match.scoreAway

    if (prediction.tripleActive && !exactCorrect) continue

    const scaledAdvances = advancesCorrect ? Math.round(ptsAdvances * scaleFactor) : 0
    const scaledExact = exactCorrect ? Math.round(ptsExact * scaleFactor) : 0
    const tripleBonus = exactCorrect && prediction.tripleActive ? multTriple : 0

    if (scaledAdvances > 0) {
      events.push({ participantId: prediction.participantId, paramKey: 'pts_ko_advances', matchId, groupId: null, roundSlug, points: scaledAdvances })
    }
    if (scaledExact > 0) {
      events.push({ participantId: prediction.participantId, paramKey: 'pts_ko_exact_score', matchId, groupId: null, roundSlug, points: scaledExact })
    }
    if (tripleBonus > 0) {
      events.push({ participantId: prediction.participantId, paramKey: 'mult_triple', matchId, groupId: null, roundSlug, points: tripleBonus })
    }
  }

  await prisma.$transaction([
    prisma.scoreEvent.deleteMany({
      where: { matchId, paramKey: { in: ['pts_ko_advances', 'pts_ko_exact_score', 'mult_triple'] } },
    }),
    prisma.scoreEvent.createMany({ data: events }),
  ])
}

export async function persistPowerupKoMatchEvents(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({ where: { id: matchId }, include: { round: true } })
  if (!match || !match.winnerTeamId) return

  const roundSlug = match.round.slug
  const scaleSlug = SCALE_SLUG_MAP[roundSlug]
  if (!scaleSlug) return

  const [ptsDarkHorse, ptsDisappointment, scaleFactor, powerups] = await Promise.all([
    getParam('pts_dark_horse_per_round'),
    getParam('pts_disappointment_per_round'),
    getParam(scaleSlug),
    prisma.powerup.findMany({
      where: {
        OR: [
          { darkHorseTeamId: match.winnerTeamId },
          { disappointmentTeamId: match.winnerTeamId },
        ],
      },
    }),
  ])

  const events: ScoreEventInput[] = []

  for (const powerup of powerups) {
    if (powerup.darkHorseTeamId === match.winnerTeamId && ptsDarkHorse > 0) {
      events.push({ participantId: powerup.participantId, paramKey: 'pts_dark_horse_per_round', matchId, groupId: null, roundSlug, points: Math.round(ptsDarkHorse * scaleFactor) })
    }
    if (powerup.disappointmentTeamId === match.winnerTeamId) {
      events.push({ participantId: powerup.participantId, paramKey: 'pts_disappointment_per_round', matchId, groupId: null, roundSlug, points: -Math.round(ptsDisappointment * scaleFactor) })
    }
  }

  await prisma.$transaction([
    prisma.scoreEvent.deleteMany({
      where: { matchId, paramKey: { in: ['pts_dark_horse_per_round', 'pts_disappointment_per_round'] } },
    }),
    prisma.scoreEvent.createMany({ data: events }),
  ])
}

export async function persistThirdScoreEvents(): Promise<void> {
  const [ptsThird, qualifiedStandings, participants] = await Promise.all([
    getParam('pts_third_correct'),
    prisma.groupStanding.findMany({ where: { qualifiedAsThird: true }, select: { teamId: true } }),
    prisma.participant.findMany({ select: { id: true } }),
  ])

  const qualifiedTeamIds = new Set(qualifiedStandings.map((s) => s.teamId))
  if (qualifiedTeamIds.size === 0) return

  const allThirdPredictions = await prisma.thirdPrediction.findMany({
    where: { participantId: { in: participants.map((p) => p.id) } },
  })

  const events: ScoreEventInput[] = []
  for (const { id: participantId } of participants) {
    const preds = allThirdPredictions.filter((p) => p.participantId === participantId)
    for (const pred of preds) {
      if (qualifiedTeamIds.has(pred.teamId)) {
        events.push({ participantId, paramKey: 'pts_third_correct', matchId: null, groupId: null, roundSlug: null, points: ptsThird })
      }
    }
  }

  await prisma.$transaction([
    prisma.scoreEvent.deleteMany({ where: { paramKey: 'pts_third_correct' } }),
    prisma.scoreEvent.createMany({ data: events }),
  ])
}

export async function recalculateParticipantScores(participantId: string): Promise<number> {
  const [groupEvents, thirdEvents, koEvents, powerupEvents] = await Promise.all([
    buildGroupEvents(participantId),
    buildThirdEvents(participantId),
    buildKoEvents(participantId),
    buildPowerupEvents(participantId),
  ])

  const allEvents = [...groupEvents, ...thirdEvents, ...koEvents, ...powerupEvents]

  await prisma.$transaction([
    prisma.scoreEvent.deleteMany({ where: { participantId } }),
    prisma.scoreEvent.createMany({ data: allEvents }),
  ])

  return allEvents.length
}

export async function recalculateAllScores(): Promise<{ participants: number; events: number }> {
  const participants = await prisma.participant.findMany({ select: { id: true } })

  let totalEvents = 0
  for (const { id } of participants) {
    totalEvents += await recalculateParticipantScores(id)
  }

  return { participants: participants.length, events: totalEvents }
}
