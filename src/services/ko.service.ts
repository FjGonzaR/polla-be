import type { KoPrediction, Match, RoundSlug, Team } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { getParam } from './scoring.service.js'
import {
  toKoMatchDto,
  toKoRoundDto,
  toKoFriendDto,
  type KoMatchDto,
  type KoPointsEarnedDto,
  type KoRoundDto,
  type KoFriendDto,
} from '../mappers/ko.mapper.js'

const KO_ROUND_SLUGS: RoundSlug[] = ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL']

const SCALE_SLUG_MAP: Partial<Record<RoundSlug, string>> = {
  R32: 'scale_r32',
  R16: 'scale_r16',
  QF: 'scale_qf',
  SF: 'scale_sf',
  THIRD: 'scale_sf',
  FINAL: 'scale_final',
}

type MatchWithTeamsAndPredictions = Match & {
  homeTeam: Team | null
  awayTeam: Team | null
  koPredictions: KoPrediction[]
}

type LedgerEvent = { paramKey: string; points: number }

async function buildPointsEarned(
  prediction: KoPrediction,
  match: Match,
  roundSlug: RoundSlug,
  ledgerEvents?: LedgerEvent[],
): Promise<KoPointsEarnedDto | null> {
  if (match.scoreHome == null || match.scoreAway == null || match.winnerTeamId == null) return null

  const scaleSlug = SCALE_SLUG_MAP[roundSlug]
  if (!scaleSlug) return null

  // Prefer ledger when events exist for this prediction
  if (ledgerEvents && ledgerEvents.length > 0) {
    const sum = (key: string) =>
      ledgerEvents.filter((e) => e.paramKey === key).reduce((acc, e) => acc + e.points, 0)
    const ptsAdvances = sum('pts_ko_advances')
    const ptsExact = sum('pts_ko_exact_score')
    const tripleBonus = sum('mult_triple')
    const scaleFactor = await getParam(scaleSlug)
    return {
      pts_ko_advances: ptsAdvances,
      pts_ko_exact_score: ptsExact,
      mult_triple: tripleBonus,
      scale_factor: scaleFactor,
      scale_slug: scaleSlug,
      total: ptsAdvances + ptsExact + tripleBonus,
    }
  }

  // Inline fallback
  const [ptsAdvances, ptsExact, multTriple, scaleFactor] = await Promise.all([
    getParam('pts_ko_advances'),
    getParam('pts_ko_exact_score'),
    getParam('mult_triple'),
    getParam(scaleSlug),
  ])

  const advancesCorrect = prediction.teamAdvancesId === match.winnerTeamId
  const exactCorrect =
    advancesCorrect &&
    prediction.scoreHome === match.scoreHome &&
    prediction.scoreAway === match.scoreAway

  if (prediction.tripleActive && !exactCorrect) {
    return {
      pts_ko_advances: 0,
      pts_ko_exact_score: 0,
      mult_triple: 0,
      scale_factor: scaleFactor,
      scale_slug: scaleSlug,
      total: 0,
    }
  }

  const earnedAdvances = advancesCorrect ? ptsAdvances : 0
  const earnedExact = exactCorrect ? ptsExact : 0
  const tripleBonus = exactCorrect && prediction.tripleActive ? multTriple : 0
  const total = Math.round((earnedAdvances + earnedExact) * scaleFactor) + tripleBonus

  return {
    pts_ko_advances: earnedAdvances,
    pts_ko_exact_score: earnedExact,
    mult_triple: tripleBonus,
    scale_factor: scaleFactor,
    scale_slug: scaleSlug,
    total,
  }
}

async function buildMatchDto(
  match: MatchWithTeamsAndPredictions,
  roundSlug: RoundSlug,
  participantId: string,
  ledgerByMatch: Map<string, LedgerEvent[]> = new Map(),
): Promise<KoMatchDto> {
  const prediction = match.koPredictions.find((p) => p.participantId === participantId) ?? null
  const ledgerEvents = ledgerByMatch.get(match.id)
  const pointsEarned = prediction
    ? await buildPointsEarned(prediction, match, roundSlug, ledgerEvents)
    : null
  return toKoMatchDto(match, prediction, pointsEarned)
}

export async function findKoMatches(
  roundSlug: string,
  participantId: string,
): Promise<{ round: KoRoundDto; matches: KoMatchDto[] }> {
  if (!KO_ROUND_SLUGS.includes(roundSlug as RoundSlug)) {
    throw new AppError(400, 'INVALID_ROUND', `Invalid roundSlug: ${roundSlug}`)
  }

  const slug = roundSlug as RoundSlug

  const round = await prisma.round.findUnique({
    where: { slug },
    include: {
      matches: {
        orderBy: { matchNumber: 'asc' },
        include: {
          homeTeam: true,
          awayTeam: true,
          koPredictions: { where: { participantId } },
        },
      },
    },
  })

  if (!round) throw new AppError(404, 'ROUND_NOT_FOUND', 'Round not found')

  const matchIds = round.matches.map((m) => m.id)
  const rawLedgerEvents = await prisma.scoreEvent.findMany({
    where: {
      participantId,
      matchId: { in: matchIds },
      paramKey: { in: ['pts_ko_advances', 'pts_ko_exact_score', 'mult_triple'] },
    },
    select: { matchId: true, paramKey: true, points: true },
  })

  const ledgerByMatch = new Map<string, LedgerEvent[]>()
  for (const e of rawLedgerEvents) {
    if (!e.matchId) continue
    if (!ledgerByMatch.has(e.matchId)) ledgerByMatch.set(e.matchId, [])
    ledgerByMatch.get(e.matchId)!.push({ paramKey: e.paramKey, points: e.points })
  }

  const matches = await Promise.all(
    round.matches.map((match) => buildMatchDto(match, slug, participantId, ledgerByMatch)),
  )

  return { round: toKoRoundDto(round), matches }
}

async function countTripleUses(participantId: string, excludeMatchId?: string): Promise<number> {
  return prisma.koPrediction.count({
    where: {
      participantId,
      tripleActive: true,
      ...(excludeMatchId ? { matchId: { not: excludeMatchId } } : {}),
    },
  })
}

interface KoPredictionBody {
  scoreHome: number
  scoreAway: number
  teamAdvancesId: string
  tripleActive: boolean
}

async function fetchMatchForWrite(matchId: string) {
  const match = await prisma.match.findUnique({ where: { id: matchId } })
  if (!match) throw new AppError(404, 'MATCH_NOT_FOUND', 'Match not found')
  if (match.status === 'FINISHED') throw new AppError(423, 'MATCH_FINISHED', 'Match already has an official result')
  if (new Date() >= new Date(match.scheduledAt.getTime() - 30 * 60 * 1000)) throw new AppError(423, 'MATCH_LOCKED', 'Match is closed for predictions')
  return match
}

export async function createKoPrediction(
  matchId: string,
  participantId: string,
  body: KoPredictionBody,
): Promise<{ ok: true; tripleUsesRemaining: number }> {
  const match = await fetchMatchForWrite(matchId)

  if (body.teamAdvancesId !== match.homeTeamId && body.teamAdvancesId !== match.awayTeamId) {
    throw new AppError(400, 'INVALID_TEAM_ADVANCES', 'teamAdvancesId does not match a team in this match')
  }

  if (body.tripleActive) {
    const used = await countTripleUses(participantId)
    if (used >= 3) throw new AppError(400, 'TRIPLE_USES_EXHAUSTED', 'No triple or nothing uses remaining')
  }

  const existing = await prisma.koPrediction.findUnique({
    where: { participantId_matchId: { participantId, matchId } },
  })
  if (existing) throw new AppError(409, 'PREDICTION_ALREADY_EXISTS', 'A prediction already exists for this match')

  await prisma.koPrediction.create({
    data: {
      participantId,
      matchId,
      scoreHome: body.scoreHome,
      scoreAway: body.scoreAway,
      teamAdvancesId: body.teamAdvancesId,
      tripleActive: body.tripleActive,
    },
  })

  const used = await countTripleUses(participantId)
  return { ok: true, tripleUsesRemaining: 3 - used }
}

export async function updateKoPrediction(
  matchId: string,
  participantId: string,
  body: KoPredictionBody,
): Promise<{ ok: true; tripleUsesRemaining: number }> {
  const match = await fetchMatchForWrite(matchId)

  if (body.teamAdvancesId !== match.homeTeamId && body.teamAdvancesId !== match.awayTeamId) {
    throw new AppError(400, 'INVALID_TEAM_ADVANCES', 'teamAdvancesId does not match a team in this match')
  }

  const existing = await prisma.koPrediction.findUnique({
    where: { participantId_matchId: { participantId, matchId } },
  })
  if (!existing) throw new AppError(404, 'PREDICTION_NOT_FOUND', 'No prediction found for this match')

  if (body.tripleActive && !existing.tripleActive) {
    const usedElsewhere = await countTripleUses(participantId, matchId)
    if (usedElsewhere >= 3) throw new AppError(400, 'TRIPLE_USES_EXHAUSTED', 'No triple or nothing uses remaining')
  }

  await prisma.koPrediction.update({
    where: { participantId_matchId: { participantId, matchId } },
    data: {
      scoreHome: body.scoreHome,
      scoreAway: body.scoreAway,
      teamAdvancesId: body.teamAdvancesId,
      tripleActive: body.tripleActive,
    },
  })

  const used = await countTripleUses(participantId)
  return { ok: true, tripleUsesRemaining: 3 - used }
}

type KoFriendsPredictionsDto =
  | { available: false; matchId: string; availableAt: Date | null; data: null }
  | { available: true; matchId: string; availableAt: null; data: KoFriendDto[] }

export async function findKoMatchFriendsPredictions(
  matchId: string,
  participantId: string,
): Promise<KoFriendsPredictionsDto> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, scheduledAt: true },
  })
  if (!match) throw new AppError(404, 'MATCH_NOT_FOUND', 'Match not found')

  if (new Date() < match.scheduledAt) {
    return { available: false, matchId, availableAt: match.scheduledAt, data: null }
  }

  const [others, predictions] = await Promise.all([
    prisma.participant.findMany({
      where: { id: { not: participantId } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.koPrediction.findMany({
      where: { matchId, participantId: { not: participantId } },
    }),
  ])

  const predictionMap = new Map(predictions.map((p) => [p.participantId, p]))
  const data = others.map((p) => toKoFriendDto(p, predictionMap.get(p.id) ?? null))

  return { available: true, matchId, availableAt: null, data }
}

export async function findKoMatch(matchId: string, participantId: string): Promise<KoMatchDto> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      round: true,
      homeTeam: true,
      awayTeam: true,
      koPredictions: { where: { participantId } },
    },
  })

  if (!match) throw new AppError(404, 'MATCH_NOT_FOUND', 'Match not found')

  const prediction = match.koPredictions[0] ?? null

  let ledgerEvents: LedgerEvent[] | undefined
  if (prediction && match.scoreHome != null) {
    const events = await prisma.scoreEvent.findMany({
      where: {
        participantId,
        matchId,
        paramKey: { in: ['pts_ko_advances', 'pts_ko_exact_score', 'mult_triple'] },
      },
      select: { paramKey: true, points: true },
    })
    if (events.length > 0) ledgerEvents = events
  }

  const pointsEarned = prediction
    ? await buildPointsEarned(prediction, match, match.round.slug, ledgerEvents)
    : null

  return toKoMatchDto(match, prediction, pointsEarned)
}
