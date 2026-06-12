import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { recalculateGroupStandings } from '../../services/group-standings.service.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'

// Powerup notifications hit the WhatsApp client; stub it (no powerups exist in
// these tests, but keep it isolated from the network regardless).
vi.mock('../../lib/whatsapp.client.js', () => ({
  sendWhatsappMessage: vi.fn().mockResolvedValue(undefined),
}))

async function buildGroupWithFourTeams(label: string, lastMatchAt: Date | null = null) {
  const group = await prisma.group.create({ data: { label, name: `Group ${label}`, lastMatchAt } })
  const teams = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      new TeamBuilder().withName(`${label}${n}`).withCode(`${label}${n}`).withGroupId(group.id).build(),
    ),
  )
  return { group, teams }
}

async function finishedMatch(homeId: string, awayId: string, sh: number, sa: number) {
  return new MatchBuilder()
    .withRoundSlug('GROUP')
    .withHomeTeamId(homeId)
    .withAwayTeamId(awayId)
    .withScore(sh, sa)
    .withStatus('FINISHED')
    .build()
}

describe('recalculateGroupStandings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes pts/gf/ga/mp/realPosition from FINISHED matches, sorted pts→gd→gf', async () => {
    const { group, teams } = await buildGroupWithFourTeams('A')
    const [t1, t2, t3, t4] = teams

    await finishedMatch(t1.id, t2.id, 2, 0) // t1 win
    await finishedMatch(t1.id, t3.id, 1, 1) // draw
    await finishedMatch(t4.id, t2.id, 0, 3) // t2 win

    await recalculateGroupStandings()

    const standings = await prisma.groupStanding.findMany({
      where: { groupId: group.id },
      orderBy: { realPosition: 'asc' },
    })
    expect(standings).toHaveLength(4)

    const byTeam = new Map(standings.map((s) => [s.teamId, s]))
    expect(byTeam.get(t1.id)).toMatchObject({ pts: 4, goalsFor: 3, goalsAgainst: 1, matchesPlayed: 2, realPosition: 1 })
    expect(byTeam.get(t2.id)).toMatchObject({ pts: 3, goalsFor: 3, goalsAgainst: 2, matchesPlayed: 2, realPosition: 2 })
    expect(byTeam.get(t3.id)).toMatchObject({ pts: 1, goalsFor: 1, goalsAgainst: 1, matchesPlayed: 1, realPosition: 3 })
    expect(byTeam.get(t4.id)).toMatchObject({ pts: 0, goalsFor: 0, goalsAgainst: 3, matchesPlayed: 1, realPosition: 4 })
  })

  it('LIVE match contributes pts/goals but NOT matchesPlayed', async () => {
    const { group, teams } = await buildGroupWithFourTeams('B')
    const [t1, t2] = teams

    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(t1.id)
      .withAwayTeamId(t2.id)
      .withScore(2, 1)
      .withStatus('LIVE')
      .build()

    await recalculateGroupStandings()

    const s1 = await prisma.groupStanding.findUnique({ where: { teamId: t1.id } })
    const s2 = await prisma.groupStanding.findUnique({ where: { teamId: t2.id } })
    expect(s1).toMatchObject({ pts: 3, goalsFor: 2, goalsAgainst: 1, matchesPlayed: 0 })
    expect(s2).toMatchObject({ pts: 0, goalsFor: 1, goalsAgainst: 2, matchesPlayed: 0 })
    expect(group.id).toBe(s1?.groupId)
  })

  it('SCHEDULED match (not started) does not contribute → team stays at zero', async () => {
    const { group, teams } = await buildGroupWithFourTeams('E')
    const [t1, t2] = teams

    // Not started: no scores, default SCHEDULED status.
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(t1.id)
      .withAwayTeamId(t2.id)
      .build()

    await recalculateGroupStandings()

    const standings = await prisma.groupStanding.findMany({ where: { groupId: group.id } })
    expect(standings).toHaveLength(4)
    expect(standings.every((s) => s.pts === 0 && s.matchesPlayed === 0 && s.goalsFor === 0 && s.goalsAgainst === 0)).toBe(true)
  })

  it('group not finalized → group_standings populated but NO score events', async () => {
    await seedScoringParams()
    const { group, teams } = await buildGroupWithFourTeams('C', null) // lastMatchAt null
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

    await finishedMatch(t1.id, t2.id, 1, 0)

    await recalculateGroupStandings()

    expect(await prisma.groupStanding.count({ where: { groupId: group.id } })).toBe(4)
    expect(await prisma.scoreEvent.count()).toBe(0)
  })

  it('group finalized (full round-robin, lastMatchAt >2h ago) → score events created', async () => {
    await seedScoringParams()
    const lastMatchAt = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const { group, teams } = await buildGroupWithFourTeams('D', lastMatchAt)
    const [t1, t2, t3, t4] = teams

    // Round-robin so every team plays 3 → final order t1 > t2 > t3 > t4.
    await finishedMatch(t1.id, t2.id, 1, 0)
    await finishedMatch(t1.id, t3.id, 1, 0)
    await finishedMatch(t1.id, t4.id, 1, 0)
    await finishedMatch(t2.id, t3.id, 1, 0)
    await finishedMatch(t2.id, t4.id, 1, 0)
    await finishedMatch(t3.id, t4.id, 1, 0)

    const participant = await buildParticipant()
    await prisma.groupPrediction.createMany({
      data: [
        { participantId: participant.id, groupId: group.id, teamId: t1.id, predictedPosition: 1 },
        { participantId: participant.id, groupId: group.id, teamId: t2.id, predictedPosition: 2 },
        { participantId: participant.id, groupId: group.id, teamId: t3.id, predictedPosition: 3 },
        { participantId: participant.id, groupId: group.id, teamId: t4.id, predictedPosition: 4 },
      ],
    })

    await recalculateGroupStandings()

    const standings = await prisma.groupStanding.findMany({
      where: { groupId: group.id },
      orderBy: { realPosition: 'asc' },
    })
    expect(standings.map((s) => s.teamId)).toEqual([t1.id, t2.id, t3.id, t4.id])
    expect(standings.every((s) => s.matchesPlayed === 3)).toBe(true)

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id, groupId: group.id } })
    expect(events.some((e) => e.paramKey === 'pts_group_position_exact')).toBe(true)
    expect(events.some((e) => e.paramKey === 'bonus_group_complete')).toBe(true)
  })
})
