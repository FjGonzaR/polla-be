import type { GroupPositionStat } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

interface GroupPositionStatOverrides {
  teamId: string
  position?: number
  pct?: number
}

export async function buildGroupPositionStat(
  overrides: GroupPositionStatOverrides,
): Promise<GroupPositionStat> {
  return prisma.groupPositionStat.create({
    data: {
      teamId: overrides.teamId,
      position: overrides.position ?? 1,
      pct: overrides.pct ?? 50.0,
    },
  })
}
