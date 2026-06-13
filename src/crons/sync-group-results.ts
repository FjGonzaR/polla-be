import { MatchStatus, RoundSlug } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { worldcupApi } from "../lib/worldcup-api.client.js";
import { recalculateGroupStandings } from "../services/group-standings.service.js";
import { withUpdatedScorers } from "../lib/match-additional-data.js";

const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

// Start of the current Colombia (UTC-5) calendar day, expressed in UTC.
function colombiaDayStart(now: Date): Date {
  const col = new Date(now.getTime() - COLOMBIA_OFFSET_MS);
  return new Date(
    Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate()) +
      COLOMBIA_OFFSET_MS,
  );
}

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
  console.info("[sync-group-results] Iniciando sincronización...");

  try {
    const ahora = new Date();

    // Only matches that may be in play right now: from today (Colombia day) and
    // already kicked off. Captures live matches and stops dragging old fixtures.
    const partidos = await prisma.match.findMany({
      where: {
        status: { not: MatchStatus.FINISHED },
        externalMatchId: { not: null },
        scheduledAt: { gte: colombiaDayStart(ahora), lte: ahora },
        round: {
          slug: RoundSlug.GROUP,
        },
      },
    });

    if (partidos.length === 0) {
      console.info(
        "[sync-group-results] Sin partidos pendientes de sincronizar",
      );
      await recalculateGroupStandings();
      console.info("[sync-group-results] group_standings recalculados");
      return;
    }

    console.info(
      `[sync-group-results] ${partidos.length} partido(s) a revisar`,
    );

    let finalizados = 0;

    for (const partido of partidos) {
      try {
        const matchExterno = await worldcupApi.getMatch(
          partido.externalMatchId!,
        );

        if (matchExterno.finished === "TRUE") {
          const scoreHome = parseInt(matchExterno.home_score);
          const scoreAway = parseInt(matchExterno.away_score);

          await prisma.match.update({
            where: { id: partido.id },
            data: {
              scoreHome,
              scoreAway,
              status: MatchStatus.FINISHED,
              additionalData: withUpdatedScorers(
                partido.additionalData,
                matchExterno,
              ),
            },
          });

          console.info(
            `[sync-group-results] Partido ${partido.id} (GROUP) actualizado: ${scoreHome}-${scoreAway}`,
          );

          finalizados++;
        } else if (
          matchExterno.finished === "FALSE" &&
          matchExterno.time_elapsed !== "notstarted"
        ) {
          const liveHome = parseInt(matchExterno.home_score);
          const liveAway = parseInt(matchExterno.away_score);

          await prisma.match.update({
            where: { id: partido.id },
            data: {
              status: MatchStatus.LIVE,
              scoreHome: liveHome,
              scoreAway: liveAway,
              additionalData: withUpdatedScorers(
                partido.additionalData,
                matchExterno,
              ),
            },
          });
          console.info(
            `[sync-group-results] Partido ${partido.id} live: ${liveHome}-${liveAway}`,
          );
        }
      } catch (errorPartido) {
        console.error(
          `[sync-group-results] Error procesando partido ${partido.id}:`,
          (errorPartido as Error).message,
        );
      }
    }

    console.info(
      `[sync-group-results] OK — ${finalizados}/${partidos.length} partido(s) finalizado(s)`,
    );

    await recalculateGroupStandings();
    console.info("[sync-group-results] group_standings recalculados");
  } catch (error) {
    console.error(
      "[sync-group-results] Error general:",
      (error as Error).message,
    );
  }
}
