import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { recalculateAllScores } from './score-calculation.service.js'
import { toInvitationDto, toScoringParamDto, type InvitationDto, type ScoringParamDto } from '../mappers/admin.mapper.js'

export async function createInvitations(count: number): Promise<InvitationDto[]> {
  if (count < 1) throw new AppError(400, 'INVALID_COUNT', 'count must be at least 1')

  const codes = Array.from({ length: count }, () =>
    crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
  )

  await prisma.invitation.createMany({ data: codes.map((code) => ({ code })) })

  const created = await prisma.invitation.findMany({
    where: { code: { in: codes } },
    include: { participant: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return created.map(toInvitationDto)
}

export async function listInvitations(): Promise<InvitationDto[]> {
  const invitations = await prisma.invitation.findMany({
    include: { participant: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return invitations.map(toInvitationDto)
}

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

  await recalculateAllScores()
}

export async function updateScoringParam(key: string, value: number): Promise<ScoringParamDto> {
  const existing = await prisma.scoringParam.findUnique({ where: { key } })
  if (!existing) throw new AppError(404, 'SCORING_PARAM_NOT_FOUND', `Scoring param '${key}' not found`)

  const updated = await prisma.scoringParam.update({ where: { key }, data: { value } })
  return toScoringParamDto(updated)
}
