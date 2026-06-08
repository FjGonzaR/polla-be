import type { Powerup, Team, Participant } from '@prisma/client'

export interface PowerupTeamDto {
  teamId: string
  name: string
  code: string
  isTop8: boolean
  flag: string | null
}

export interface MyPowerupsDto {
  darkHorse: PowerupTeamDto | null
  disappointment: PowerupTeamDto | null
}

export interface FriendPowerupsDto {
  participant: { id: string; name: string }
  darkHorse: PowerupTeamDto | null
  disappointment: PowerupTeamDto | null
}

type PowerupWithTeams = Powerup & { darkHorseTeam: Team; disappointmentTeam: Team }

function toPowerupTeamDto(team: Team): PowerupTeamDto {
  return { teamId: team.id, name: team.name, code: team.code, isTop8: team.isTop8, flag: team.flag }
}

export function toMyPowerupsDto(powerup: PowerupWithTeams | null): MyPowerupsDto {
  if (!powerup) return { darkHorse: null, disappointment: null }
  return {
    darkHorse: toPowerupTeamDto(powerup.darkHorseTeam),
    disappointment: toPowerupTeamDto(powerup.disappointmentTeam),
  }
}

export function toFriendPowerupsDto(
  participant: Participant,
  powerup: PowerupWithTeams | null,
): FriendPowerupsDto {
  return {
    participant: { id: participant.id, name: participant.name },
    darkHorse: powerup ? toPowerupTeamDto(powerup.darkHorseTeam) : null,
    disappointment: powerup ? toPowerupTeamDto(powerup.disappointmentTeam) : null,
  }
}
