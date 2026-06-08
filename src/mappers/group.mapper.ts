import type { Group, Team } from '@prisma/client'

export interface TeamDto {
  id: string
  name: string
  code: string
  isTop8: boolean
  flag: string | null
}

export interface GroupDto {
  id: string
  label: string
  name: string
  teams: TeamDto[]
}

export function toTeamDto(team: Team): TeamDto {
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    isTop8: team.isTop8,
    flag: team.flag,
  }
}

export function toGroupDto(group: Group & { teams: Team[] }): GroupDto {
  return {
    id: group.id,
    label: group.label,
    name: group.name,
    teams: group.teams.map(toTeamDto),
  }
}
