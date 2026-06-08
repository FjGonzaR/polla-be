import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { worldcupApi } from '../lib/worldcup-api.client.js'
import { persistKoMatchScoreEvents, persistPowerupKoMatchEvents } from '../services/score-calculation.service.js'

export async function syncKoResults(): Promise<void> {
  console.info('[sync-ko-results] Iniciando sincronización...')

  try {
    const ahora = new Date()
    const hace120min = new Date(ahora.getTime() - 120 * 60 * 1000)

    const partidos = await prisma.match.findMany({
      where: {
        status: { not: MatchStatus.FINISHED },
        externalMatchId: { not: null },
        scheduledAt: { lte: hace120min },
        round: {
          slug: { not: RoundSlug.GROUP },
        },
      },
      include: { round: true },
    })

    if (partidos.length === 0) {
      console.info('[sync-ko-results] Sin partidos pendientes de sincronizar')
      return
    }

    console.info(`[sync-ko-results] ${partidos.length} partido(s) a revisar`)

    let actualizados = 0

    for (const partido of partidos) {
      try {
        const matchExterno = await worldcupApi.getMatch(partido.externalMatchId!)

        if (matchExterno.finished === 'TRUE') {
          const scoreHome = parseInt(matchExterno.home_score)
          const scoreAway = parseInt(matchExterno.away_score)

          let winnerTeamId: string | null = null

          if (scoreHome !== scoreAway) {
            const winnerExternalId =
              scoreHome > scoreAway ? matchExterno.home_team_id : matchExterno.away_team_id

            const winnerTeam = await prisma.team.findFirst({
              where: { externalTeamId: winnerExternalId },
            })

            if (!winnerTeam) {
              console.warn(
                `[sync-ko-results] Partido ${partido.id}: ` +
                  `no se encontró el equipo ganador con externalTeamId "${winnerExternalId}"`,
              )
            } else {
              winnerTeamId = winnerTeam.id
            }
          } else {
            console.info(
              `[sync-ko-results] Partido ${partido.id}: empate ${scoreHome}-${scoreAway} ` +
                `— winnerTeamId requiere carga manual del admin (penales)`,
            )
          }

          await prisma.match.update({
            where: { id: partido.id },
            data: {
              scoreHome,
              scoreAway,
              status: MatchStatus.FINISHED,
              winnerTeamId: winnerTeamId ?? undefined,
            },
          })

          await persistKoMatchScoreEvents(partido.id)
          await persistPowerupKoMatchEvents(partido.id)

          console.info(
            `[sync-ko-results] Partido ${partido.id} (${partido.round.slug}) ` +
              `actualizado: ${scoreHome}-${scoreAway}` +
              (winnerTeamId ? ` | ganador: ${winnerTeamId}` : ' | ganador pendiente (admin)'),
          )

          actualizados++
        } else if (
          matchExterno.finished === 'FALSE' &&
          matchExterno.time_elapsed !== 'notstarted' &&
          partido.status !== MatchStatus.LIVE
        ) {
          await prisma.match.update({
            where: { id: partido.id },
            data: { status: MatchStatus.LIVE },
          })
          console.info(`[sync-ko-results] Partido ${partido.id} marcado como live`)
        }
      } catch (errorPartido) {
        console.error(
          `[sync-ko-results] Error procesando partido ${partido.id}:`,
          (errorPartido as Error).message,
        )
      }
    }

    console.info(
      `[sync-ko-results] OK — ${actualizados}/${partidos.length} partido(s) actualizado(s)`,
    )
  } catch (error) {
    console.error('[sync-ko-results] Error general:', (error as Error).message)
  }
}
