import { RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { worldcupApi } from '../lib/worldcup-api.client.js'

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
    }

    console.info(
      `[sync-standings] OK — ${gruposSincronizados} grupos, ` +
        `${equiposSincronizados} equipos sincronizados`,
    )
  } catch (error) {
    console.error('[sync-standings] Error durante sincronización:', (error as Error).message)
  }
}
