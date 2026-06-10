import { prisma } from '../lib/prisma.js'

export async function calculateGroupStats(): Promise<void> {
  console.info('[calculate-group-stats] Running...')

  try {
    const totalParticipants = await prisma.participant.count()
    if (totalParticipants === 0) {
      console.warn('[calculate-group-stats] No participants found — skipping')
      return
    }

    const predictions = await prisma.groupPrediction.findMany({
      select: { teamId: true, predictedPosition: true },
    })

    // Aggregate: teamId → position → count
    const counts = new Map<string, Map<number, number>>()
    for (const { teamId, predictedPosition } of predictions) {
      if (!counts.has(teamId)) counts.set(teamId, new Map())
      const byPos = counts.get(teamId)!
      byPos.set(predictedPosition, (byPos.get(predictedPosition) ?? 0) + 1)
    }

    let upserted = 0
    for (const [teamId, byPos] of counts) {
      for (const [position, count] of byPos) {
        const pct = parseFloat(((count / totalParticipants) * 100).toFixed(2))
        await prisma.groupPositionStat.upsert({
          where: { teamId_position: { teamId, position } },
          update: { pct },
          create: { teamId, position, pct },
        })
        upserted++
      }
    }

    console.info(`[calculate-group-stats] Done — ${upserted} stats upserted`)
  } catch (error) {
    console.error('[calculate-group-stats] Error:', (error as Error).message)
  }
}
