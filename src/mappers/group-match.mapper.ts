import type { Group, Match, Team } from '@prisma/client'
import { toAdditionalDataDto, type AdditionalDataDto } from './match-additional-data.mapper.js'

export interface GroupMatchTeamDto {
  id: string
  name: string
  code: string
  flag: string | null
}

export interface GroupMatchDto {
  id: string
  matchNumber: number
  groupId: string | null
  groupLabel: string | null
  scheduledAt: Date
  status: string
  homeTeam: GroupMatchTeamDto | null
  awayTeam: GroupMatchTeamDto | null
  homeTeamLabel: string | null
  awayTeamLabel: string | null
  scoreHome: number | null
  scoreAway: number | null
  additionalData: AdditionalDataDto | null
}

type TeamWithGroup = Team & { group: Group }

type MatchWithTeams = Match & {
  homeTeam: TeamWithGroup | null
  awayTeam: TeamWithGroup | null
}

export function toGroupMatchTeamDto(team: Team): GroupMatchTeamDto {
  return { id: team.id, name: team.name, code: team.code, flag: team.flag }
}

export function toGroupMatchDto(match: MatchWithTeams): GroupMatchDto {
  // Both group-stage teams share a group; derive it from whichever team is
  // set (home first, away as fallback).
  const group = match.homeTeam?.group ?? match.awayTeam?.group ?? null

  return {
    id: match.id,
    matchNumber: match.matchNumber,
    groupId: group?.id ?? null,
    groupLabel: group?.label ?? null,
    scheduledAt: match.scheduledAt,
    status: match.status,
    homeTeam: match.homeTeam ? toGroupMatchTeamDto(match.homeTeam) : null,
    awayTeam: match.awayTeam ? toGroupMatchTeamDto(match.awayTeam) : null,
    homeTeamLabel: match.homeTeamLabel ?? match.homeTeam?.name ?? null,
    awayTeamLabel: match.awayTeamLabel ?? match.awayTeam?.name ?? null,
    scoreHome: match.scoreHome,
    scoreAway: match.scoreAway,
    additionalData: toAdditionalDataDto(match.additionalData),
  }
}
