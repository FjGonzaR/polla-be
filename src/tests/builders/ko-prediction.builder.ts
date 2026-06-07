import type { KoPrediction } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

interface KoPredictionOverrides {
  participantId: string
  matchId: string
  teamAdvancesId: string
  scoreHome?: number
  scoreAway?: number
  tripleActive?: boolean
}

export async function buildKoPrediction(overrides: KoPredictionOverrides): Promise<KoPrediction> {
  return prisma.koPrediction.create({
    data: {
      participantId: overrides.participantId,
      matchId: overrides.matchId,
      teamAdvancesId: overrides.teamAdvancesId,
      scoreHome: overrides.scoreHome ?? 1,
      scoreAway: overrides.scoreAway ?? 0,
      tripleActive: overrides.tripleActive ?? false,
    },
  })
}
