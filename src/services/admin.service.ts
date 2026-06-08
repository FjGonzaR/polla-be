import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import {
  persistKoMatchScoreEvents,
  persistPowerupKoMatchEvents,
  persistThirdScoreEvents,
} from './score-calculation.service.js'
import { toScoringParamDto, type ScoringParamDto } from '../mappers/admin.mapper.js'

interface MatchResultInput {
  scoreHome: number
  scoreAway: number
  winnerTeamId: string
}

export async function setMatchResult(matchId: string, body: MatchResultInput): Promise<void> {
  const match = await prisma.match.findUnique({ where: { id: matchId } })
  if (!match) throw new AppError(404, 'MATCH_NOT_FOUND', 'Match not found')

  if (body.winnerTeamId !== match.homeTeamId && body.winnerTeamId !== match.awayTeamId) {
    throw new AppError(400, 'INVALID_WINNER', 'winnerTeamId must be homeTeamId or awayTeamId of this match')
  }

  await prisma.match.update({
    where: { id: matchId },
    data: {
      scoreHome: body.scoreHome,
      scoreAway: body.scoreAway,
      winnerTeamId: body.winnerTeamId,
      status: 'FINISHED',
    },
  })

  await persistKoMatchScoreEvents(matchId)
  await persistPowerupKoMatchEvents(matchId)
}

export async function setQualifiedThirds(teamIds: string[]): Promise<void> {
  if (teamIds.length !== 8) {
    throw new AppError(400, 'INVALID_THIRDS_COUNT', 'Exactly 8 team IDs required')
  }

  const standings = await prisma.groupStanding.findMany({
    where: { realPosition: 3 },
    select: { teamId: true },
  })
  const allThirdTeamIds = new Set(standings.map((s) => s.teamId))

  for (const teamId of teamIds) {
    if (!allThirdTeamIds.has(teamId)) {
      throw new AppError(400, 'INVALID_THIRD_TEAM', `Team ${teamId} is not a third-place team`)
    }
  }

  const qualifiedSet = new Set(teamIds)
  await prisma.$transaction(
    standings.map((s) =>
      prisma.groupStanding.update({
        where: { teamId: s.teamId },
        data: { qualifiedAsThird: qualifiedSet.has(s.teamId) },
      }),
    ),
  )

  await persistThirdScoreEvents()
}

export async function updateScoringParam(key: string, value: number): Promise<ScoringParamDto> {
  const existing = await prisma.scoringParam.findUnique({ where: { key } })
  if (!existing) throw new AppError(404, 'SCORING_PARAM_NOT_FOUND', `Scoring param '${key}' not found`)

  const updated = await prisma.scoringParam.update({ where: { key }, data: { value } })
  return toScoringParamDto(updated)
}
