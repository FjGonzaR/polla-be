import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { worldcupApi } from '../lib/worldcup-api.client.js'
import { recalculateGroupStandings } from '../services/group-standings.service.js'

/**
 * Syncs group-stage match scores/status from the external API, then recomputes
 * group_standings from those results.
 *
 * This is now the live source for standings (replacing sync-standings). After
 * updating match scores it calls recalculateGroupStandings(), which derives
 * group_standings from the match results and — once a group is finalized —
 * persists group score_events (same behavior sync-standings used to trigger).
 * It still never sets winnerTeamId (draws are normal in the group stage) nor
 * touches MatchPredictionStat for group matches.
 */
export async function syncGroupResults(): Promise<void> {
  console.info('[sync-group-results] Iniciando sincronización...')

  try {
    const ahora = new Date()
    const hace120min = new Date(ahora.getTime() - 120 * 60 * 1000)

    const partidos = await prisma.match.findMany({
      where: {
        status: { not: MatchStatus.FINISHED },
        externalMatchId: { not: null },
        scheduledAt: { lte: hace120min },
        round: {
          slug: RoundSlug.GROUP,
        },
      },
    })

    if (partidos.length === 0) {
      console.info('[sync-group-results] Sin partidos pendientes de sincronizar')
      await recalculateGroupStandings()
      console.info('[sync-group-results] group_standings recalculados')
      return
    }

    console.info(`[sync-group-results] ${partidos.length} partido(s) a revisar`)

    let actualizados = 0

    for (const partido of partidos) {
      try {
        const matchExterno = await worldcupApi.getMatch(partido.externalMatchId!)

        if (matchExterno.finished === 'TRUE') {
          const scoreHome = parseInt(matchExterno.home_score)
          const scoreAway = parseInt(matchExterno.away_score)

          await prisma.match.update({
            where: { id: partido.id },
            data: {
              scoreHome,
              scoreAway,
              status: MatchStatus.FINISHED,
            },
          })

          console.info(
            `[sync-group-results] Partido ${partido.id} (GROUP) actualizado: ${scoreHome}-${scoreAway}`,
          )

          actualizados++
        } else if (
          matchExterno.finished === 'FALSE' &&
          matchExterno.time_elapsed !== 'notstarted'
        ) {
          const liveHome = parseInt(matchExterno.home_score)
          const liveAway = parseInt(matchExterno.away_score)

          await prisma.match.update({
            where: { id: partido.id },
            data: {
              status: MatchStatus.LIVE,
              scoreHome: liveHome,
              scoreAway: liveAway,
            },
          })
          console.info(
            `[sync-group-results] Partido ${partido.id} live: ${liveHome}-${liveAway}`,
          )
        }
      } catch (errorPartido) {
        console.error(
          `[sync-group-results] Error procesando partido ${partido.id}:`,
          (errorPartido as Error).message,
        )
      }
    }

    console.info(
      `[sync-group-results] OK — ${actualizados}/${partidos.length} partido(s) actualizado(s)`,
    )

    await recalculateGroupStandings()
    console.info('[sync-group-results] group_standings recalculados')
  } catch (error) {
    console.error('[sync-group-results] Error general:', (error as Error).message)
  }
}
