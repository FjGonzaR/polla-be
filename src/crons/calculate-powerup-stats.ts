import { PowerupType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export async function calculatePowerupStats(): Promise<void> {
  console.info('[calculate-powerup-stats] Running...')

  try {
    const totalParticipants = await prisma.participant.count()
    if (totalParticipants === 0) {
      console.warn('[calculate-powerup-stats] No participants found — skipping')
      return
    }

    const powerups = await prisma.powerup.findMany({
      select: { darkHorseTeamId: true, disappointmentTeamId: true },
    })

    if (powerups.length === 0) {
      console.warn('[calculate-powerup-stats] No powerups found — skipping')
      return
    }

    const darkHorseCounts = new Map<string, number>()
    const disappointmentCounts = new Map<string, number>()

    for (const { darkHorseTeamId, disappointmentTeamId } of powerups) {
      darkHorseCounts.set(darkHorseTeamId, (darkHorseCounts.get(darkHorseTeamId) ?? 0) + 1)
      disappointmentCounts.set(disappointmentTeamId, (disappointmentCounts.get(disappointmentTeamId) ?? 0) + 1)
    }

    let upserted = 0

    for (const [teamId, count] of darkHorseCounts) {
      const pct = parseFloat(((count / totalParticipants) * 100).toFixed(2))
      await prisma.powerupStat.upsert({
        where: { teamId_type: { teamId, type: PowerupType.DARK_HORSE } },
        update: { pct },
        create: { teamId, type: PowerupType.DARK_HORSE, pct },
      })
      upserted++
    }

    for (const [teamId, count] of disappointmentCounts) {
      const pct = parseFloat(((count / totalParticipants) * 100).toFixed(2))
      await prisma.powerupStat.upsert({
        where: { teamId_type: { teamId, type: PowerupType.DISAPPOINTMENT } },
        update: { pct },
        create: { teamId, type: PowerupType.DISAPPOINTMENT, pct },
      })
      upserted++
    }

    console.info(`[calculate-powerup-stats] Done — ${upserted} stats upserted`)
  } catch (error) {
    console.error('[calculate-powerup-stats] Error:', (error as Error).message)
  }
}
