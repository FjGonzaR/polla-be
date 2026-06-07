import { prisma } from '../lib/prisma.js'

export async function getParam(key: string): Promise<number> {
  const param = await prisma.scoringParam.findUniqueOrThrow({ where: { key } })
  return Number(param.value)
}
