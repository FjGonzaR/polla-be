import { prisma } from '../lib/prisma.js'
import { worldcupApi } from '../lib/worldcup-api.client.js'
import {
  isGroupFinalized,
  persistGroupScoreEvents,
  persistThirdScoreEvents,
} from '../services/score-calculation.service.js'

async function maybeUpdateQualifiedThirds(): Promise<void> {
  const allGroups = await prisma.group.findMany({
    select: { id: true, lastMatchAt: true, standings: { select: { matchesPlayed: true, teamId: true, pts: true, goalsFor: true, goalsAgainst: true, realPosition: true } } },
  })

  if (allGroups.length !== 12) return
  const allFinalized = allGroups.every((g) => isGroupFinalized(g, g.standings))
  if (!allFinalized) return

  const thirds = allGroups
    .map((g) => g.standings.find((s) => s.realPosition === 3))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .sort((a, b) =>
      b.pts - a.pts ||
      (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor,
    )

  if (thirds.length !== 12) return

  const qualifiedIds = new Set(thirds.slice(0, 8).map((s) => s.teamId))

  await prisma.$transaction(
    thirds.map((s) =>
      prisma.groupStanding.update({
        where: { teamId: s.teamId },
        data: { qualifiedAsThird: qualifiedIds.has(s.teamId) },
      }),
    ),
  )

  await persistThirdScoreEvents()
  console.info('[sync-standings] Thirds ranking updated and score events persisted')
}

export async function syncStandings(): Promise<void> {
  console.info('[sync-standings] Iniciando sincronización...')

  try {
    const standings = await worldcupApi.getStandings()

    let gruposSincronizados = 0
    let equiposSincronizados = 0

    for (const grupoExterno of standings) {
      const group = await prisma.group.findFirst({
        where: { label: grupoExterno.name },
      })
      if (!group) {
        console.warn(`[sync-standings] Grupo "${grupoExterno.name}" no encontrado en BD`)
        continue
      }

      const equiposResueltos: Array<{
        team: { id: string }
        pts: number
        gf: number
        ga: number
        gd: number
        mp: number
      }> = []

      for (const teamExterno of grupoExterno.teams) {
        const team = await prisma.team.findFirst({
          where: { externalTeamId: teamExterno.team_id },
        })
        if (!team) {
          console.warn(
            `[sync-standings] Team con externalTeamId "${teamExterno.team_id}" no encontrado en BD`,
          )
          continue
        }
        equiposResueltos.push({
          team,
          pts: parseInt(teamExterno.pts),
          gf: parseInt(teamExterno.gf),
          ga: parseInt(teamExterno.ga),
          gd: parseInt(teamExterno.gd),
          mp: parseInt(teamExterno.mp),
        })
      }

      if (equiposResueltos.length !== 4) {
        console.warn(
          `[sync-standings] Grupo "${grupoExterno.name}" tiene solo ` +
            `${equiposResueltos.length}/4 equipos resueltos — saltando`,
        )
        continue
      }

      const ordenados = [...equiposResueltos].sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts
        if (b.gd !== a.gd) return b.gd - a.gd
        return b.gf - a.gf
      })

      for (let i = 0; i < ordenados.length; i++) {
        const { team, pts, gf, ga, mp } = ordenados[i]
        const realPosition = i + 1

        await prisma.groupStanding.upsert({
          where: { teamId: team.id },
          update: {
            pts,
            goalsFor: gf,
            goalsAgainst: ga,
            matchesPlayed: mp,
            realPosition,
            groupId: group.id,
          },
          create: {
            teamId: team.id,
            groupId: group.id,
            pts,
            goalsFor: gf,
            goalsAgainst: ga,
            matchesPlayed: mp,
            realPosition,
            qualifiedAsThird: false,
          },
        })
        equiposSincronizados++
      }

      gruposSincronizados++

      const updatedStandings = await prisma.groupStanding.findMany({ where: { groupId: group.id } })
      if (isGroupFinalized(group, updatedStandings)) {
        await persistGroupScoreEvents(group.id)
      }
    }

    await maybeUpdateQualifiedThirds()

    console.info(
      `[sync-standings] OK — ${gruposSincronizados} grupos, ` +
        `${equiposSincronizados} equipos sincronizados`,
    )
  } catch (error) {
    console.error('[sync-standings] Error durante sincronización:', (error as Error).message)
  }
}
