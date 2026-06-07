import { prisma } from './prisma.js'

export async function isGroupPhaseLocked(): Promise<boolean> {
  const round = await prisma.round.findUnique({
    where: { slug: 'GROUP' },
    select: { lockedAt: true },
  })
  return round?.lockedAt != null && round.lockedAt <= new Date()
}
