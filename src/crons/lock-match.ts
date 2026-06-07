import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

const KO_ROUND_SLUGS: RoundSlug[] = ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL']

export async function lockMatches(): Promise<void> {
  try {
    const threshold = new Date(Date.now() + 30 * 60 * 1000)

    const matches = await prisma.match.findMany({
      where: {
        status: MatchStatus.SCHEDULED,
        lockedAt: null,
        scheduledAt: { lte: threshold },
        round: { slug: { in: KO_ROUND_SLUGS } },
      },
    })

    if (matches.length === 0) return

    for (const match of matches) {
      await prisma.match.update({
        where: { id: match.id },
        data: { lockedAt: new Date(match.scheduledAt.getTime() - 30 * 60 * 1000) },
      })
    }

    console.info(`[lock-match] Locked ${matches.length} match(es)`)
  } catch (error) {
    console.error('[lock-match] Error:', (error as Error).message)
  }
}
