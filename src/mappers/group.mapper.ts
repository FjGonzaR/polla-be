import type { Group, GroupPositionStat, GroupStanding, Team } from '@prisma/client'

export interface PositionStatDto {
  position: number
  pct: number
}

export interface StandingDto {
  realPosition: number | null
  pts: number
  matchesPlayed: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
}

export interface TeamDto {
  id: string
  name: string
  code: string
  isTop8: boolean
  flag: string | null
  positionStats: PositionStatDto[] | null
  standing: StandingDto | null
}

export interface GroupDto {
  id: string
  label: string
  name: string
  locked: boolean
  teams: TeamDto[]
}

export function toStandingDto(standing: GroupStanding): StandingDto {
  return {
    realPosition: standing.realPosition,
    pts: standing.pts,
    matchesPlayed: standing.matchesPlayed,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    goalDiff: standing.goalsFor - standing.goalsAgainst,
  }
}

export function toTeamDto(
  team: Team,
  stats: GroupPositionStat[] | null = null,
  standing: GroupStanding | null = null,
): TeamDto {
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    isTop8: team.isTop8,
    flag: team.flag,
    positionStats: stats ? stats.map((s) => ({ position: s.position, pct: s.pct })) : null,
    standing: standing ? toStandingDto(standing) : null,
  }
}

type TeamWithRelations = Team & {
  positionStats: GroupPositionStat[]
  standing: GroupStanding | null
}

// Teams with a known realPosition come first (in table order); the rest follow.
function compareByStanding(a: TeamWithRelations, b: TeamWithRelations): number {
  const posA = a.standing?.realPosition ?? Number.MAX_SAFE_INTEGER
  const posB = b.standing?.realPosition ?? Number.MAX_SAFE_INTEGER
  return posA - posB
}

export function toGroupDto(group: Group & { teams: TeamWithRelations[] }): GroupDto {
  return {
    id: group.id,
    label: group.label,
    name: group.name,
    locked: group.lockedAt != null && group.lockedAt <= new Date(),
    teams: [...group.teams]
      .sort(compareByStanding)
      .map((t) =>
        toTeamDto(t, t.positionStats.length > 0 ? t.positionStats : null, t.standing),
      ),
  }
}
