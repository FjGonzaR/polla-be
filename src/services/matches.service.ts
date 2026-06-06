import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { syncKoResults } from '../crons/sync-ko-results.js'

export async function fetchResultIfNeeded(matchId: string): Promise<void> {
  const partido = await prisma.match.findUnique({
    where: { id: matchId },
    include: { round: true },
  })
  if (!partido) return
  if (partido.status === MatchStatus.FINISHED) return
  if (!partido.externalMatchId) return
  if (partido.round.slug === RoundSlug.GROUP) return

  const hace120min = new Date(Date.now() - 120 * 60 * 1000)
  if (partido.scheduledAt > hace120min) return

  await syncKoResults()
}
