import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  isGroupFinalized,
  persistGroupScoreEvents,
} from './score-calculation.service.js'
import { sendPowerupGroupNotifications } from '../crons/powerup-group-notification.js'

interface TeamTally {
  pts: number
  goalsFor: number
  goalsAgainst: number
  matchesPlayed: number
}

/**
 * Recomputes group_standings from the actual group-stage match results.
 *
 * Replaces the external-API standings fetch (sync-standings) as the live source:
 * - LIVE and FINISHED matches both contribute pts/goalsFor/goalsAgainst, so the table
 *   updates in real time as scores come in.
 * - matchesPlayed counts ONLY FINISHED matches, so a live match never prematurely
 *   satisfies the group-finalized check.
 * - Tiebreaker: pts → goal difference → goals for (same as sync-standings).
 *
 * group_standings is always refreshed. score_events are only persisted once the group
 * is finalized (isGroupFinalized: 2h after the last match + all 4 teams with 3 played).
 */
export async function recalculateGroupStandings(groupId?: string): Promise<void> {
  const groups = await prisma.group.findMany({
    where: groupId ? { id: groupId } : undefined,
    include: { teams: true },
  })

  for (const group of groups) {
    const tallies = new Map<string, TeamTally>()
    for (const team of group.teams) {
      tallies.set(team.id, { pts: 0, goalsFor: 0, goalsAgainst: 0, matchesPlayed: 0 })
    }

    const matches = await prisma.match.findMany({
      where: {
        round: { slug: RoundSlug.GROUP },
        status: { in: [MatchStatus.FINISHED, MatchStatus.LIVE] },
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        scoreHome: { not: null },
        scoreAway: { not: null },
        homeTeam: { is: { groupId: group.id } },
      },
    })

    for (const match of matches) {
      const home = tallies.get(match.homeTeamId!)
      const away = tallies.get(match.awayTeamId!)
      if (!home || !away) continue

      const scoreHome = match.scoreHome!
      const scoreAway = match.scoreAway!

      home.goalsFor += scoreHome
      home.goalsAgainst += scoreAway
      away.goalsFor += scoreAway
      away.goalsAgainst += scoreHome

      if (scoreHome > scoreAway) {
        home.pts += 3
      } else if (scoreHome < scoreAway) {
        away.pts += 3
      } else {
        home.pts += 1
        away.pts += 1
      }

      if (match.status === MatchStatus.FINISHED) {
        home.matchesPlayed += 1
        away.matchesPlayed += 1
      }
    }

    const ranked = [...tallies.entries()]
      .map(([teamId, t]) => ({ teamId, ...t, gd: t.goalsFor - t.goalsAgainst }))
      .sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts
        if (b.gd !== a.gd) return b.gd - a.gd
        return b.goalsFor - a.goalsFor
      })

    for (let i = 0; i < ranked.length; i++) {
      const { teamId, pts, goalsFor, goalsAgainst, matchesPlayed } = ranked[i]
      const realPosition = i + 1

      await prisma.groupStanding.upsert({
        where: { teamId },
        update: { pts, goalsFor, goalsAgainst, matchesPlayed, realPosition, groupId: group.id },
        create: {
          teamId,
          groupId: group.id,
          pts,
          goalsFor,
          goalsAgainst,
          matchesPlayed,
          realPosition,
          qualifiedAsThird: false,
        },
      })
    }

    const standings = await prisma.groupStanding.findMany({ where: { groupId: group.id } })
    if (isGroupFinalized(group, standings)) {
      await persistGroupScoreEvents(group.id)
      await sendPowerupGroupNotifications(group.id)
    }
  }
}
