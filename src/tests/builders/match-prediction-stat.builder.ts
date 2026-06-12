import { type MatchPredictionStat } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

interface MatchPredictionStatOverrides {
  matchId: string
  totalPredictions?: number
  pctHomeWin?: number
  pctDraw?: number
  pctAwayWin?: number
  pctTripleActive?: number
  topScoreHome?: number | null
  topScoreAway?: number | null
  topScorePct?: number
}

export async function buildMatchPredictionStat(
  overrides: MatchPredictionStatOverrides,
): Promise<MatchPredictionStat> {
  return prisma.matchPredictionStat.create({
    data: {
      matchId: overrides.matchId,
      totalPredictions: overrides.totalPredictions ?? 10,
      pctHomeWin: overrides.pctHomeWin ?? 60,
      pctDraw: overrides.pctDraw ?? 10,
      pctAwayWin: overrides.pctAwayWin ?? 30,
      pctTripleActive: overrides.pctTripleActive ?? 20,
      topScoreHome: overrides.topScoreHome ?? 2,
      topScoreAway: overrides.topScoreAway ?? 1,
      topScorePct: overrides.topScorePct ?? 40,
    },
  })
}
