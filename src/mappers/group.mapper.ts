import type { Group, GroupPositionStat, Team } from '@prisma/client'

export interface PositionStatDto {
  position: number
  pct: number
}

export interface TeamDto {
  id: string
  name: string
  code: string
  isTop8: boolean
  flag: string | null
  positionStats: PositionStatDto[] | null
}

export interface GroupDto {
  id: string
  label: string
  name: string
  locked: boolean
  teams: TeamDto[]
}

export function toTeamDto(team: Team, stats: GroupPositionStat[] | null = null): TeamDto {
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    isTop8: team.isTop8,
    flag: team.flag,
    positionStats: stats ? stats.map((s) => ({ position: s.position, pct: s.pct })) : null,
  }
}

export function toGroupDto(
  group: Group & { teams: (Team & { positionStats: GroupPositionStat[] })[] },
): GroupDto {
  return {
    id: group.id,
    label: group.label,
    name: group.name,
    locked: group.lockedAt != null && group.lockedAt <= new Date(),
    teams: group.teams.map((t) =>
      toTeamDto(t, t.positionStats.length > 0 ? t.positionStats : null),
    ),
  }
}
