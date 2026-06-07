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
    if (groupStandings.length !== 4 || groupStandings.some((s) => s.realPosition === null)) continue

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

    if (match.winnerTeamId === powerup.darkHorseTeamId && ptsDarkHorse > 0) {
      events.push({ participantId, paramKey: 'pts_dark_horse_per_round', matchId: null, groupId: null, roundSlug, points: ptsDarkHorse })
    }

    if (match.winnerTeamId === powerup.disappointmentTeamId) {
      events.push({ participantId, paramKey: 'pts_disappointment_per_round', matchId: null, groupId: null, roundSlug, points: -ptsDisappointment })
    }
  }

  return events
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
