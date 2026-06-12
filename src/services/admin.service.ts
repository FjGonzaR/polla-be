import { type RoundSlug, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { worldcupApi } from '../lib/worldcup-api.client.js'
import {
  persistKoMatchScoreEvents,
  persistPowerupKoMatchEvents,
  persistPowerupGroupEvents,
  persistThirdScoreEvents,
} from './score-calculation.service.js'
import {
  toScoringParamDto,
  toTop8TeamDto,
  toAdminParticipantDto,
  type ScoringParamDto,
  type Top8TeamDto,
  type AdminParticipantDto,
} from '../mappers/admin.mapper.js'

interface MatchResultInput {
  scoreHome: number
  scoreAway: number
  winnerTeamId: string
}

interface MatchResultDto {
  ok: boolean
  matchId: string
  scoreHome: number
  scoreAway: number
  winnerTeamId: string
}

export async function setMatchResult(matchId: string, body: MatchResultInput): Promise<MatchResultDto> {
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

  return { ok: true, matchId, ...body }
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
  await persistPowerupGroupEvents()
}

export async function updateScoringParam(key: string, value: number): Promise<ScoringParamDto> {
  const existing = await prisma.scoringParam.findUnique({ where: { key } })
  if (!existing) throw new AppError(404, 'SCORING_PARAM_NOT_FOUND', `Scoring param '${key}' not found`)

  const updated = await prisma.scoringParam.update({ where: { key }, data: { value } })
  return toScoringParamDto(updated)
}

interface TeamInput {
  name: string
  code: string
  isTop8: boolean
}

interface GroupInput {
  label: string
  name: string
  lastMatchAt?: string | null
  teams: TeamInput[]
}

export async function loadGroups(groups: GroupInput[]): Promise<{ groupsCount: number; teamsCount: number }> {
  const existing = await prisma.group.count()
  if (existing > 0) throw new AppError(409, 'GROUPS_ALREADY_LOADED', 'Groups have already been loaded')

  if (groups.length !== 12) {
    throw new AppError(400, 'INVALID_GROUPS_PAYLOAD', 'Exactly 12 groups required')
  }
  for (const group of groups) {
    if (group.teams.length !== 4) {
      throw new AppError(400, 'INVALID_GROUPS_PAYLOAD', `Group ${group.label} must have exactly 4 teams`)
    }
  }

  await prisma.$transaction(
    groups.map((g) =>
      prisma.group.create({
        data: {
          label: g.label,
          name: g.name,
          lastMatchAt: g.lastMatchAt ? new Date(g.lastMatchAt) : null,
          teams: { create: g.teams.map((t) => ({ name: t.name, code: t.code, isTop8: t.isTop8 })) },
        },
      }),
    ),
  )

  return { groupsCount: 12, teamsCount: 48 }
}

interface KoMatchInput {
  externalMatchId: string | number
  matchNumber?: number | null
  homeTeamId?: string | null
  awayTeamId?: string | null
  homeTeamLabel?: string | null
  awayTeamLabel?: string | null
  scheduledAt?: string | null
}

interface ResolvedMatchData {
  matchNumber: number
  homeTeamId: string | null
  awayTeamId: string | null
  homeTeamLabel: string | null
  awayTeamLabel: string | null
  scheduledAt: Date
  additionalData: Prisma.InputJsonObject | null
}

function parseLocalDate(localDate: string): Date {
  // Format from external API: "MM/DD/YYYY HH:mm"
  const [datePart, timePart] = localDate.split(' ')
  const [month, day, year] = datePart.split('/')
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}:00Z`)
}

async function resolveMatchFromApi(externalMatchId: string): Promise<ResolvedMatchData> {
  const game = await worldcupApi.getMatch(externalMatchId)

  const [homeTeam, awayTeam] = await Promise.all([
    game.home_team_id !== '0'
      ? prisma.team.findFirst({ where: { externalTeamId: game.home_team_id } })
      : null,
    game.away_team_id !== '0'
      ? prisma.team.findFirst({ where: { externalTeamId: game.away_team_id } })
      : null,
  ])

  let stadiumFields: Prisma.InputJsonObject = {}
  if (game.stadium_id) {
    try {
      const stadium = await worldcupApi.getStadium(game.stadium_id)
      stadiumFields = {
        stadiumName: stadium.name_en,
        stadiumCity: stadium.city_en,
        stadiumCountry: stadium.country_en,
        stadiumCapacity: stadium.capacity,
      }
    } catch {
      // best-effort: continue without stadium data
    }
  }

  const additionalData: Prisma.InputJsonObject = {
    homeScorers: game.home_scorers ?? null,
    awayScorers: game.away_scorers ?? null,
    ...stadiumFields,
  }

  return {
    matchNumber: parseInt(game.id, 10),
    homeTeamId: homeTeam?.id ?? null,
    awayTeamId: awayTeam?.id ?? null,
    homeTeamLabel: homeTeam ? null : (game.home_team_label ?? null),
    awayTeamLabel: awayTeam ? null : (game.away_team_label ?? null),
    scheduledAt: parseLocalDate(game.local_date),
    additionalData,
  }
}

export async function loadKoMatches(
  roundSlug: RoundSlug,
  matches: KoMatchInput[],
): Promise<{ roundSlug: RoundSlug; matchesCount: number }> {
  const round = await prisma.round.findUnique({ where: { slug: roundSlug } })
  if (!round) throw new AppError(404, 'ROUND_NOT_FOUND', `Round '${roundSlug}' not found`)

  for (const m of matches) {
    const extId = String(m.externalMatchId)
    const resolved: ResolvedMatchData = m.scheduledAt
      ? {
          matchNumber: m.matchNumber!,
          homeTeamId: m.homeTeamId ?? null,
          awayTeamId: m.awayTeamId ?? null,
          homeTeamLabel: m.homeTeamLabel ?? null,
          awayTeamLabel: m.awayTeamLabel ?? null,
          scheduledAt: new Date(m.scheduledAt),
          additionalData: null,
        }
      : await resolveMatchFromApi(extId)

    await prisma.match.upsert({
      where: { externalMatchId: extId },
      create: {
        roundId: round.id,
        externalMatchId: extId,
        matchNumber: resolved.matchNumber,
        homeTeamId: resolved.homeTeamId,
        awayTeamId: resolved.awayTeamId,
        homeTeamLabel: resolved.homeTeamLabel,
        awayTeamLabel: resolved.awayTeamLabel,
        scheduledAt: resolved.scheduledAt,
        additionalData: resolved.additionalData ?? undefined,
      },
      update: {
        matchNumber: resolved.matchNumber,
        homeTeamId: resolved.homeTeamId,
        awayTeamId: resolved.awayTeamId,
        homeTeamLabel: resolved.homeTeamLabel,
        awayTeamLabel: resolved.awayTeamLabel,
        scheduledAt: resolved.scheduledAt,
        ...(resolved.additionalData !== null && { additionalData: resolved.additionalData }),
      },
    })
  }

  return { roundSlug, matchesCount: matches.length }
}

export async function setTop8Teams(teamIds: string[]): Promise<{ ok: boolean; teams: Top8TeamDto[] }> {
  if (teamIds.length !== 8) {
    throw new AppError(400, 'INVALID_TOP8_COUNT', 'Exactly 8 team IDs required')
  }

  const teams = await prisma.team.findMany({ where: { id: { in: teamIds } } })
  if (teams.length !== 8) {
    throw new AppError(404, 'TEAM_NOT_FOUND', 'One or more team IDs not found')
  }

  const idSet = new Set(teamIds)
  await prisma.$transaction([
    prisma.team.updateMany({ data: { isTop8: false } }),
    ...teamIds.map((id) => prisma.team.update({ where: { id }, data: { isTop8: true } })),
  ])

  const updated = teams.map((t) => ({ ...t, isTop8: true }))
  return { ok: true, teams: updated.filter((t) => idSet.has(t.id)).map(toTop8TeamDto) }
}

export async function listParticipants(): Promise<AdminParticipantDto[]> {
  const [participants, scoreGroups] = await Promise.all([
    prisma.participant.findMany({ orderBy: { name: 'asc' } }),
    prisma.scoreEvent.groupBy({ by: ['participantId'], _sum: { points: true } }),
  ])

  const pointsMap = new Map(scoreGroups.map((g) => [g.participantId, Number(g._sum.points ?? 0)]))

  return participants.map((p) => toAdminParticipantDto(p, pointsMap.get(p.id) ?? 0))
}
