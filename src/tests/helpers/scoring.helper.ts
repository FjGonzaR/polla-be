import { prisma } from '../../lib/prisma.js'

const DEFAULT_SCORING_PARAMS: Record<string, number> = {
  pts_group_position_exact: 3,
  bonus_group_complete: 5,
  pts_third_correct: 2,
  pts_ko_advances: 4,
  pts_ko_exact_score: 6,
  mult_triple: 3,
  pts_dark_horse_per_round: 8,
  pts_disappointment_per_round: 5,
  scale_group: 1,
  scale_r32: 1,
  scale_r16: 1.5,
  scale_qf: 2,
  scale_sf: 3,
  scale_final: 4,
}

export async function seedScoringParams(overrides: Record<string, number> = {}): Promise<void> {
  const params = { ...DEFAULT_SCORING_PARAMS, ...overrides }
  await prisma.scoringParam.createMany({
    data: Object.entries(params).map(([key, value]) => ({ key, value, description: key })),
    skipDuplicates: true,
  })
}
