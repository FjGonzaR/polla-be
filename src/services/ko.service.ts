import type { KoPrediction, Match, RoundSlug, Team } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { getParam } from './scoring.service.js'
import {
  toKoMatchDto,
  toKoRoundDto,
  type KoMatchDto,
  type KoPointsEarnedDto,
  type KoRoundDto,
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

async function buildPointsEarned(
  prediction: KoPrediction,
  match: Match,
  roundSlug: RoundSlug,
): Promise<KoPointsEarnedDto | null> {
  if (match.scoreHome == null || match.scoreAway == null || match.winnerTeamId == null) return null

  const scaleSlug = SCALE_SLUG_MAP[roundSlug]
  if (!scaleSlug) return null

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
): Promise<KoMatchDto> {
  const prediction = match.koPredictions.find((p) => p.participantId === participantId) ?? null
  const pointsEarned = prediction ? await buildPointsEarned(prediction, match, roundSlug) : null
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

  const matches = await Promise.all(
    round.matches.map((match) => buildMatchDto(match, slug, participantId)),
  )

  return { round: toKoRoundDto(round), matches }
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
  const pointsEarned = prediction
    ? await buildPointsEarned(prediction, match, match.round.slug)
    : null

  return toKoMatchDto(match, prediction, pointsEarned)
}
