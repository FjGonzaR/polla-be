import type { KoPrediction, Match, Round, Team } from '@prisma/client'

export interface KoTeamDto {
  id: string
  name: string
  code: string
}

export interface KoResultDto {
  scoreHome: number
  scoreAway: number
  winnerTeamId: string
}

export interface KoPointsEarnedDto {
  pts_ko_advances: number
  pts_ko_exact_score: number
  mult_triple: number
  scale_factor: number
  scale_slug: string
  total: number
}

export interface KoMyPredictionDto {
  scoreHome: number
  scoreAway: number
  teamAdvancesId: string
  tripleActive: boolean
  lockedIn: boolean
  pointsEarned: KoPointsEarnedDto | null
}

export interface KoMatchDto {
  id: string
  externalMatchId: number | null
  matchNumber: number
  scheduledAt: Date
  lockedAt: Date | null
  status: string
  homeTeam: KoTeamDto | null
  awayTeam: KoTeamDto | null
  homeTeamLabel: string | null
  awayTeamLabel: string | null
  result: KoResultDto | null
  myPrediction: KoMyPredictionDto | null
}

export interface KoRoundDto {
  slug: string
  name: string
  order: number
}

type MatchWithTeams = Match & {
  homeTeam: Team | null
  awayTeam: Team | null
}

export interface KoFriendPredictionDto {
  scoreHome: number
  scoreAway: number
  teamAdvancesId: string
  tripleActive: boolean
}

export interface KoFriendDto {
  participant: { id: string; name: string }
  prediction: KoFriendPredictionDto | null
}

export function toKoFriendDto(
  participant: { id: string; name: string },
  prediction: KoPrediction | null,
): KoFriendDto {
  return {
    participant: { id: participant.id, name: participant.name },
    prediction: prediction
      ? {
          scoreHome: prediction.scoreHome,
          scoreAway: prediction.scoreAway,
          teamAdvancesId: prediction.teamAdvancesId,
          tripleActive: prediction.tripleActive,
        }
      : null,
  }
}

export function toKoTeamDto(team: Team): KoTeamDto {
  return { id: team.id, name: team.name, code: team.code }
}

export function toKoRoundDto(round: Round): KoRoundDto {
  return { slug: round.slug, name: round.name, order: round.order }
}

export function toKoMatchDto(
  match: MatchWithTeams,
  prediction: KoPrediction | null,
  pointsEarned: KoPointsEarnedDto | null,
): KoMatchDto {
  const lockedIn = match.lockedAt != null && new Date() >= match.lockedAt

  const result: KoResultDto | null =
    match.scoreHome != null && match.scoreAway != null && match.winnerTeamId != null
      ? { scoreHome: match.scoreHome, scoreAway: match.scoreAway, winnerTeamId: match.winnerTeamId }
      : null

  const myPrediction: KoMyPredictionDto | null = prediction
    ? {
        scoreHome: prediction.scoreHome,
        scoreAway: prediction.scoreAway,
        teamAdvancesId: prediction.teamAdvancesId,
        tripleActive: prediction.tripleActive,
        lockedIn,
        pointsEarned,
      }
    : null

  return {
    id: match.id,
    externalMatchId: match.externalMatchId != null ? parseInt(match.externalMatchId, 10) : null,
    matchNumber: match.matchNumber,
    scheduledAt: match.scheduledAt,
    lockedAt: match.lockedAt,
    status: match.status,
    homeTeam: match.homeTeam ? toKoTeamDto(match.homeTeam) : null,
    awayTeam: match.awayTeam ? toKoTeamDto(match.awayTeam) : null,
    homeTeamLabel: match.homeTeam?.name ?? null,
    awayTeamLabel: match.awayTeam?.name ?? null,
    result,
    myPrediction,
  }
}
