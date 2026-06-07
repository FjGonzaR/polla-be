import type { ScoringParam } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export async function buildScoringParam(overrides: Partial<{ key: string; value: number; description: string }> = {}): Promise<ScoringParam> {
  const uid = Math.random().toString(36).slice(2, 8)
  return prisma.scoringParam.create({
    data: {
      key: overrides.key ?? `param_${uid}`,
      value: overrides.value ?? 1,
      description: overrides.description ?? 'test param',
    },
  })
}
