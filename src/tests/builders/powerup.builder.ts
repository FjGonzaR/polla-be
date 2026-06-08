import type { Powerup } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { TeamBuilder } from './team.builder.js'

interface PowerupOverrides {
  participantId?: string
  darkHorseTeamId?: string
  disappointmentTeamId?: string
}

export class PowerupBuilder {
  private overrides: PowerupOverrides = {}

  withParticipantId(participantId: string): this {
    this.overrides.participantId = participantId
    return this
  }

  withDarkHorseTeamId(darkHorseTeamId: string): this {
    this.overrides.darkHorseTeamId = darkHorseTeamId
    return this
  }

  withDisappointmentTeamId(disappointmentTeamId: string): this {
    this.overrides.disappointmentTeamId = disappointmentTeamId
    return this
  }

  async build(participantId: string): Promise<Powerup> {
    const darkHorseTeamId =
      this.overrides.darkHorseTeamId ??
      (await new TeamBuilder().withIsTop8(false).build()).id

    const disappointmentTeamId =
      this.overrides.disappointmentTeamId ??
      (await new TeamBuilder().withIsTop8(true).build()).id

    return prisma.powerup.create({
      data: {
        participantId: this.overrides.participantId ?? participantId,
        darkHorseTeamId,
        disappointmentTeamId,
      },
    })
  }
}
