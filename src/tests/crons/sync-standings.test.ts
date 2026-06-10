import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { syncStandings } from '../../crons/sync-standings.js'
import type { WorldCupStanding } from '../../types/worldcup-api.types.js'

const { mockGetStandings } = vi.hoisted(() => ({
  mockGetStandings: vi.fn(),
}))

vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getStandings: mockGetStandings },
}))

async function buildGroupWithTeams(
  label: string,
  externalIds: [string, string, string, string],
  lastMatchAt: Date | null = null,
) {
  const group = await prisma.group.create({
    data: { label, name: `Group ${label}`, lastMatchAt },
  })
  const teams = await Promise.all(
    externalIds.map((extId) =>
      prisma.team.create({
        data: { name: `Team ${extId}`, code: Math.random().toString(36).slice(2, 5).toUpperCase(), groupId: group.id, externalTeamId: extId },
      }),
    ),
  )
  return { group, teams }
}

function apiStanding(
  name: string,
  teams: Array<{ extId: string; pts: number; gf: number; ga: number; mp: number }>,
): WorldCupStanding {
  return {
    _id: `ext-group-${name.toLowerCase()}`,
    name,
    teams: teams.map((t) => ({
      team_id: t.extId,
      pts: String(t.pts),
      gf: String(t.gf),
      ga: String(t.ga),
      gd: String(t.gf - t.ga),
      mp: String(t.mp),
    })),
  }
}

describe('syncStandings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts 4 GroupStanding rows with correct realPositions sorted by pts → gd → gf', async () => {
    const { group } = await buildGroupWithTeams('A', ['ext-a1', 'ext-a2', 'ext-a3', 'ext-a4'])

    mockGetStandings.mockResolvedValue([
      apiStanding('A', [
        { extId: 'ext-a3', pts: 3, gf: 2, ga: 4, mp: 3 },
        { extId: 'ext-a1', pts: 9, gf: 7, ga: 2, mp: 3 },
        { extId: 'ext-a4', pts: 0, gf: 1, ga: 5, mp: 3 },
        { extId: 'ext-a2', pts: 6, gf: 4, ga: 3, mp: 3 },
      ]),
    ])

    await syncStandings()

    const standings = await prisma.groupStanding.findMany({
      where: { groupId: group.id },
      include: { team: true },
      orderBy: { realPosition: 'asc' },
    })

    expect(standings).toHaveLength(4)
    expect(standings[0].team.externalTeamId).toBe('ext-a1')
    expect(standings[0].realPosition).toBe(1)
    expect(standings[0].pts).toBe(9)
    expect(standings[0].goalsFor).toBe(7)
    expect(standings[0].matchesPlayed).toBe(3)
    expect(standings[1].team.externalTeamId).toBe('ext-a2')
    expect(standings[1].realPosition).toBe(2)
    expect(standings[2].team.externalTeamId).toBe('ext-a3')
    expect(standings[2].realPosition).toBe(3)
    expect(standings[3].team.externalTeamId).toBe('ext-a4')
    expect(standings[3].realPosition).toBe(4)
  })

  it('group label not found in DB → no standings upserted', async () => {
    mockGetStandings.mockResolvedValue([
      apiStanding('Z', [
        { extId: 'ext-z1', pts: 9, gf: 7, ga: 2, mp: 3 },
        { extId: 'ext-z2', pts: 6, gf: 4, ga: 3, mp: 3 },
        { extId: 'ext-z3', pts: 3, gf: 2, ga: 4, mp: 3 },
        { extId: 'ext-z4', pts: 0, gf: 1, ga: 5, mp: 3 },
      ]),
    ])

    await syncStandings()

    const count = await prisma.groupStanding.count()
    expect(count).toBe(0)
  })

  it('one team externalTeamId not in DB → group skipped, no standings upserted', async () => {
    await buildGroupWithTeams('A', ['ext-a1', 'ext-a2', 'ext-a3', 'ext-a4'])

    mockGetStandings.mockResolvedValue([
      apiStanding('A', [
        { extId: 'ext-a1', pts: 9, gf: 7, ga: 2, mp: 3 },
        { extId: 'ext-a2', pts: 6, gf: 4, ga: 3, mp: 3 },
        { extId: 'ext-a3', pts: 3, gf: 2, ga: 4, mp: 3 },
        { extId: 'ext-unknown', pts: 0, gf: 1, ga: 5, mp: 3 },
      ]),
    ])

    await syncStandings()

    const count = await prisma.groupStanding.count()
    expect(count).toBe(0)
  })

  it('group finalized (lastMatchAt >2h ago, mp=3) → persistGroupScoreEvents fires, score events created', async () => {
    await seedScoringParams()
    const lastMatchAt = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const { group, teams } = await buildGroupWithTeams(
      'A',
      ['ext-a1', 'ext-a2', 'ext-a3', 'ext-a4'],
      lastMatchAt,
    )
    const [t1, t2, t3, t4] = teams

    const participant = await buildParticipant()
    await prisma.groupPrediction.createMany({
      data: [
        { participantId: participant.id, groupId: group.id, teamId: t1.id, predictedPosition: 1 },
        { participantId: participant.id, groupId: group.id, teamId: t2.id, predictedPosition: 2 },
        { participantId: participant.id, groupId: group.id, teamId: t3.id, predictedPosition: 3 },
        { participantId: participant.id, groupId: group.id, teamId: t4.id, predictedPosition: 4 },
      ],
    })

    // API returns teams sorted so t1→pos1, t2→pos2, t3→pos3, t4→pos4
    mockGetStandings.mockResolvedValue([
      apiStanding('A', [
        { extId: 'ext-a1', pts: 9, gf: 7, ga: 2, mp: 3 },
        { extId: 'ext-a2', pts: 6, gf: 4, ga: 3, mp: 3 },
        { extId: 'ext-a3', pts: 3, gf: 2, ga: 4, mp: 3 },
        { extId: 'ext-a4', pts: 0, gf: 1, ga: 5, mp: 3 },
      ]),
    ])

    await syncStandings()

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e) => e.paramKey === 'pts_group_position_exact')).toBe(true)
  })

  it('group not yet finalized (lastMatchAt = null) → no score events created', async () => {
    await seedScoringParams()
    const { group, teams } = await buildGroupWithTeams('A', ['ext-a1', 'ext-a2', 'ext-a3', 'ext-a4'], null)
    const [t1, t2, t3, t4] = teams

    const participant = await buildParticipant()
    await prisma.groupPrediction.createMany({
      data: [
        { participantId: participant.id, groupId: group.id, teamId: t1.id, predictedPosition: 1 },
        { participantId: participant.id, groupId: group.id, teamId: t2.id, predictedPosition: 2 },
        { participantId: participant.id, groupId: group.id, teamId: t3.id, predictedPosition: 3 },
        { participantId: participant.id, groupId: group.id, teamId: t4.id, predictedPosition: 4 },
      ],
    })

    mockGetStandings.mockResolvedValue([
      apiStanding('A', [
        { extId: 'ext-a1', pts: 9, gf: 7, ga: 2, mp: 3 },
        { extId: 'ext-a2', pts: 6, gf: 4, ga: 3, mp: 3 },
        { extId: 'ext-a3', pts: 3, gf: 2, ga: 4, mp: 3 },
        { extId: 'ext-a4', pts: 0, gf: 1, ga: 5, mp: 3 },
      ]),
    ])

    await syncStandings()

    const count = await prisma.scoreEvent.count()
    expect(count).toBe(0)
  })

  it('API error → function resolves without throwing, no standings written', async () => {
    mockGetStandings.mockRejectedValue(new Error('Network timeout'))

    await expect(syncStandings()).resolves.toBeUndefined()

    const count = await prisma.groupStanding.count()
    expect(count).toBe(0)
  })
})
