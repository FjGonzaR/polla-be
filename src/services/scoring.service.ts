import { prisma } from '../lib/prisma.js'

export async function getParam(key: string): Promise<number> {
  const param = await prisma.scoringParam.findUniqueOrThrow({ where: { key } })
  return Number(param.value)
}

// Resolves Colombia's team id (unique code 'COL'). Returns null when Colombia
// isn't loaded or didn't qualify, so the KO multiplier degrades to a no-op.
export async function getColombiaTeamId(): Promise<string | null> {
  const team = await prisma.team.findUnique({ where: { code: 'COL' }, select: { id: true } })
  return team?.id ?? null
}
