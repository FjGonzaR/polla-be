import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import {
  persistGroupScoreEvents,
  persistKoMatchScoreEvents,
  persistPowerupKoMatchEvents,
  persistPowerupGroupEvents,
} from '../../services/score-calculation.service.js'

// ─── helpers ────────────────────────────────────────────────────────────────

async function seedScoringParams(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    pts_group_position_exact: 3,
    bonus_group_complete: 5,
    pts_third_correct: 2,
    pts_ko_advances: 4,
    pts_ko_exact_score: 6,
    mult_triple: 3,
    pts_dark_horse_per_round: 8,
    pts_disappointment_per_round: 5,
    scale_group: 1,
    scale_r32: 1,
    scale_r16: 1.5,
    scale_qf: 2,
    scale_sf: 3,
    scale_final: 4,
  }
  const params = { ...defaults, ...overrides }
  await prisma.scoringParam.createMany({
    data: Object.entries(params).map(([key, value]) => ({
      key,
      value,
      description: key,
    })),
  })
}

async function buildFinalizedGroup(label = 'A') {
  const group = await prisma.group.create({
    data: {
      name: `Group ${label}`,
      label,
      lastMatchAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago → finalized
    },
  })
  const teams = await Promise.all(
    [1, 2, 3, 4].map((i) =>
      prisma.team.create({ data: { name: `Team ${label}${i}`, code: `${label}T${i}`, groupId: group.id } }),
    ),
  )
  return { group, teams }
}

async function buildKoMatch(roundSlug = 'R32', matchNumber = 1) {
  const round = await prisma.round.upsert({
    where: { slug: roundSlug as never },
    create: { name: roundSlug, slug: roundSlug as never, order: 1, matchCount: 16 },
    update: {},
  })
  const group = await prisma.group.create({ data: { name: 'KO Group', label: 'Z' } })
  const home = await prisma.team.create({ data: { name: 'Home FC', code: 'HFC', groupId: group.id } })
  const away = await prisma.team.create({ data: { name: 'Away FC', code: 'AFC', groupId: group.id } })
  const match = await prisma.match.create({
    data: {
      roundId: round.id,
      matchNumber,
      scheduledAt: new Date('2026-07-01T18:00:00Z'),
      homeTeamId: home.id,
      awayTeamId: away.id,
    },
  })
  return { match, home, away, round }
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('GET /scoreboard', () => {
  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard' })
    expect(res.statusCode).toBe(401)
  })

  it('no score events → all participants at 0 pts, sorted by name as tiebreak', async () => {
    const { cookie } = await createAuthenticatedParticipant({ name: 'Zara' })
    await buildParticipant({ name: 'Alice' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ updatedAt: string; data: { rank: number; total: number; participant: { name: string } }[] }>()
    expect(body.updatedAt).toBeDefined()
    expect(body.data.length).toBe(2)
    expect(body.data.every((e) => e.total === 0)).toBe(true)
    expect(body.data.every((e) => e.rank === 1)).toBe(true)
  })

  it('returns correct ranking, tiebreaker, and prizes', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'Alpha' })
    const p2 = await buildParticipant({ name: 'Beta' })
    const p3 = await buildParticipant({ name: 'Gamma' })

    // p1: 100 pts total (90 group + 10 exact KO), 1 exact KO score
    // p2: 100 pts total (80 group + 10+10 exact KO), 2 exact KO scores → wins tiebreak
    // p3: 50 pts
    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 90 },
        { participantId: p2.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 80 },
        { participantId: p3.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 50 },
        { participantId: p1.id, paramKey: 'pts_ko_exact_score', matchId: null, groupId: null, roundSlug: null, points: 10 },
        { participantId: p2.id, paramKey: 'pts_ko_exact_score', matchId: null, groupId: null, roundSlug: null, points: 10 },
        { participantId: p2.id, paramKey: 'pts_ko_exact_score', matchId: null, groupId: null, roundSlug: null, points: 10 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json<{ data: { rank: number; total: number; participant: { name: string }; prize: number | null }[] }>()

    expect(data[0].participant.name).toBe('Beta')
    expect(data[0].rank).toBe(1)
    expect(data[0].total).toBe(100)
    expect(data[0].prize).toBe(800000)

    expect(data[1].participant.name).toBe('Alpha')
    expect(data[1].rank).toBe(2)
    expect(data[1].prize).toBe(300000)

    expect(data[2].participant.name).toBe('Gamma')
    expect(data[2].rank).toBe(3)
    expect(data[2].total).toBe(50)
    expect(data[2].prize).toBe(100000)
  })

  it('tied participants share the same rank', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'A' })
    const p2 = await buildParticipant({ name: 'B' })

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
        { participantId: p2.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json<{ data: { rank: number }[] }>()
    expect(data.every((e) => e.rank === 1)).toBe(true)
  })

  it('2-way tie for 1st → prize splits (800K+300K)/2 = 550K each', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'A' })
    const p2 = await buildParticipant({ name: 'B' })
    const p3 = await buildParticipant({ name: 'C' })

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
        { participantId: p2.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
        { participantId: p3.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const { data } = res.json<{ data: { rank: number; prize: number | null }[] }>()

    const tied = data.filter((e) => e.rank === 1)
    expect(tied).toHaveLength(2)
    expect(tied.every((e) => e.prize === 550000)).toBe(true) // (800K + 300K) / 2

    const third = data.find((e) => e.rank === 3)
    expect(third?.prize).toBe(100000)
  })

  it('2-way tie for 2nd → prize splits (300K+100K)/2 = 200K each', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'A' })
    const p2 = await buildParticipant({ name: 'B' })
    const p3 = await buildParticipant({ name: 'C' })

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 200 },
        { participantId: p2.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
        { participantId: p3.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const { data } = res.json<{ data: { rank: number; prize: number | null }[] }>()

    expect(data[0].rank).toBe(1)
    expect(data[0].prize).toBe(800000)

    const tied = data.filter((e) => e.rank === 2)
    expect(tied).toHaveLength(2)
    expect(tied.every((e) => e.prize === 200000)).toBe(true) // (300K + 100K) / 2
  })

  it('tie outside top 3 → prize null', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'A' })
    const p2 = await buildParticipant({ name: 'B' })
    const p3 = await buildParticipant({ name: 'C' })
    const p4 = await buildParticipant({ name: 'D' })

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 300 },
        { participantId: p2.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 200 },
        { participantId: p3.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
        { participantId: p4.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const { data } = res.json<{ data: { rank: number; prize: number | null }[] }>()

    const tied = data.filter((e) => e.rank === 3)
    expect(tied).toHaveLength(2)
    expect(tied.every((e) => e.prize === 50000)).toBe(true) // 100K / 2 = 50K
  })

  it('viewer outside top 10 → 11 entries with viewer appended last', async () => {
    const { cookie, participant: viewer } = await createAuthenticatedParticipant({ name: 'Viewer' })

    // 10 participants with more points than viewer
    for (let i = 1; i <= 10; i++) {
      const p = await buildParticipant({ name: `Top${i}` })
      await prisma.scoreEvent.create({
        data: { participantId: p.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 + i },
      })
    }
    // viewer has fewer points
    await prisma.scoreEvent.create({
      data: { participantId: viewer.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 1 },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json<{ data: { rank: number; participant: { id: string } }[] }>()
    expect(data).toHaveLength(11)
    expect(data[10].participant.id).toBe(viewer.id)
    expect(data[10].rank).toBe(11)
  })

  it('viewer inside top 10 → exactly 10 entries, no duplication', async () => {
    const { cookie, participant: viewer } = await createAuthenticatedParticipant({ name: 'Viewer' })

    for (let i = 1; i <= 5; i++) {
      const p = await buildParticipant({ name: `Other${i}` })
      await prisma.scoreEvent.create({
        data: { participantId: p.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: i },
      })
    }
    await prisma.scoreEvent.create({
      data: { participantId: viewer.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })

    const { data } = res.json<{ data: { participant: { id: string } }[] }>()
    expect(data).toHaveLength(6)
    expect(data.filter((e) => e.participant.id === viewer.id)).toHaveLength(1)
  })

  it('tie entirely outside prize positions (rank 4+) → prize null', async () => {
    const { participant: p1, cookie } = await createAuthenticatedParticipant({ name: 'A' })
    const p2 = await buildParticipant({ name: 'B' })
    const p3 = await buildParticipant({ name: 'C' })
    const p4 = await buildParticipant({ name: 'D' })
    const p5 = await buildParticipant({ name: 'E' })

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 300 },
        { participantId: p2.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 200 },
        { participantId: p3.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 100 },
        { participantId: p4.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
        { participantId: p5.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 50 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const { data } = res.json<{ data: { rank: number; prize: number | null }[] }>()

    const tied = data.filter((e) => e.rank === 4)
    expect(tied).toHaveLength(2)
    expect(tied.every((e) => e.prize === null)).toBe(true)
  })

  // ── scoring pipeline ────────────────────────────────────────────────────

  it('group predictions with provisional standings (matchesPlayed=1, no score_event) → provisional points shown', async () => {
    await seedScoringParams({ pts_group_position_exact: 3, bonus_group_complete: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { group, teams } = await buildFinalizedGroup('P')

    // standings exist with realPosition but only 1 match played — provisional, not persisted
    await prisma.groupStanding.createMany({
      data: teams.map((t, i) => ({ teamId: t.id, groupId: group.id, realPosition: i + 1, matchesPlayed: 1 })),
    })
    await prisma.groupPrediction.createMany({
      data: teams.map((t, i) => ({
        participantId: participant.id,
        groupId: group.id,
        teamId: t.id,
        predictedPosition: i + 1,
      })),
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(4 * 3 + 5) // 17 pts — all provisional
  })

  it('provisional standings with matchesPlayed=0 → no points shown (pre-tournament data)', async () => {
    await seedScoringParams({ pts_group_position_exact: 3, bonus_group_complete: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { group, teams } = await buildFinalizedGroup('Q')

    await prisma.groupStanding.createMany({
      data: teams.map((t, i) => ({ teamId: t.id, groupId: group.id, realPosition: i + 1, matchesPlayed: 0 })),
    })
    await prisma.groupPrediction.createMany({
      data: teams.map((t, i) => ({
        participantId: participant.id,
        groupId: group.id,
        teamId: t.id,
        predictedPosition: i + 1,
      })),
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(0)
  })

  it('disappointment team at realPosition=1 with matchesPlayed=0 (pre-tournament standings) → total = 0', async () => {
    await seedScoringParams({ pts_disappointment_per_round: 5, pts_dark_horse_per_round: 8, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group PreT', label: 'V' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DHv', code: 'DHV', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DPv', code: 'DPV', groupId: grp.id } })
    // sync-standings assigns realPosition before any match is played
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 3, matchesPlayed: 0 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 1, matchesPlayed: 0 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { participant: { id: string }; total: number }[] }>().data.find((e) => e.participant.id === participant.id)
    expect(entry!.total).toBe(0)
  })

  it('group predictions: 4/4 exact → pts_group_position_exact*4 + bonus via persistGroupScoreEvents', async () => {
    await seedScoringParams({ pts_group_position_exact: 3, bonus_group_complete: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { group, teams } = await buildFinalizedGroup('B')

    // standings: realPosition matches team order
    await prisma.groupStanding.createMany({
      data: teams.map((t, i) => ({
        teamId: t.id,
        groupId: group.id,
        realPosition: i + 1,
        matchesPlayed: 3,
      })),
    })

    // predictions: all 4 positions correct
    await prisma.groupPrediction.createMany({
      data: teams.map((t, i) => ({
        participantId: participant.id,
        groupId: group.id,
        teamId: t.id,
        predictedPosition: i + 1,
      })),
    })

    await persistGroupScoreEvents(group.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data.find(() => true)
    expect(entry?.total).toBe(4 * 3 + 5) // 17
  })

  it('group predictions: 2/4 exact → pts_group_position_exact*2, no bonus', async () => {
    await seedScoringParams({ pts_group_position_exact: 3, bonus_group_complete: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { group, teams } = await buildFinalizedGroup('C')

    await prisma.groupStanding.createMany({
      data: teams.map((t, i) => ({ teamId: t.id, groupId: group.id, realPosition: i + 1, matchesPlayed: 3 })),
    })

    // participant predicts positions 1,2 correctly, swaps 3 and 4
    const predictedPositions = [1, 2, 4, 3]
    await prisma.groupPrediction.createMany({
      data: teams.map((t, i) => ({
        participantId: participant.id,
        groupId: group.id,
        teamId: t.id,
        predictedPosition: predictedPositions[i],
      })),
    })

    await persistGroupScoreEvents(group.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(2 * 3) // 6, no bonus
  })

  it('KO advances correct + exact score → pts reflected via persistKoMatchScoreEvents', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 2, scoreAway: 0, winnerTeamId: home.id, status: 'FINISHED' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: home.id, tripleActive: false },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    // (4 + 6) * scale_r32(1) = 10
    expect(entry.total).toBe(10)
  })

  it('KO triple active + exact score → adds mult_triple bonus', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 1, scoreAway: 0, winnerTeamId: home.id, status: 'FINISHED' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: home.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    // (4 + 6) * 1 + 3 = 13
    expect(entry.total).toBe(13)
  })

  it('KO triple active + wrong exact score → 0 pts (triple-or-nothing penalty)', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 2, scoreAway: 0, winnerTeamId: home.id, status: 'FINISHED' },
    })
    // correct advances, wrong score
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: home.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(0)
  })

  it('dark horse team wins → pts_dark_horse_per_round via persistPowerupKoMatchEvents', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    const darkHorse = home
    const group = await prisma.group.findFirst({ where: { label: 'Z' } })
    const otherTeam = await prisma.team.create({ data: { name: 'Other', code: 'OTH', groupId: group!.id } })

    await prisma.powerup.create({
      data: {
        participantId: participant.id,
        darkHorseTeamId: darkHorse.id,
        disappointmentTeamId: otherTeam.id,
      },
    })
    await prisma.match.update({
      where: { id: match.id },
      data: { winnerTeamId: darkHorse.id, status: 'FINISHED' },
    })

    await persistPowerupKoMatchEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(8)
  })

  it('dark horse qualified, group rung not yet persisted → provisional, then unchanged after persist', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group PG', label: 'Y' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DHy', code: 'DHY', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DPy', code: 'DPY', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 1, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 4, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    const server = await buildServer()

    // provisional (no score_event persisted yet)
    let res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    let entry = res.json<{ data: { participant: { id: string }; total: number }[] }>().data.find((e) => e.participant.id === participant.id)
    expect(entry!.total).toBe(8)

    // after persistence → identical total, no double count
    await persistPowerupGroupEvents()
    res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    entry = res.json<{ data: { participant: { id: string }; total: number }[] }>().data.find((e) => e.participant.id === participant.id)
    expect(entry!.total).toBe(8)
  })

  // ── provisional KO live scoring ─────────────────────────────────────────

  it('LIVE match, home leading, prediction correct → provisional pts_ko_advances + pts_ko_exact_score', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 2, scoreAway: 0, status: 'LIVE' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: home.id, tripleActive: false },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    // (4 + 6) * scale_r32(1) = 10
    expect(entry.total).toBe(10)
  })

  it('LIVE match, tie, prediction score matches → provisional pts_ko_exact_score only (no advances)', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 1, scoreAway: 1, status: 'LIVE' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 1, teamAdvancesId: home.id, tripleActive: false },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    // no advances (tie), exact matches → 6 * 1 = 6
    expect(entry.total).toBe(6)
  })

  it('LIVE match, tie, prediction score does not match → 0 provisional pts', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 1, scoreAway: 1, status: 'LIVE' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: home.id, tripleActive: false },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(0)
  })

  it('LIVE match, triple_active, exact miss → 0 pts (triple-or-nothing)', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 2, scoreAway: 0, status: 'LIVE' },
    })
    // correct advances, wrong score
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: home.id, tripleActive: true },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(0)
  })

  it('LIVE → FINISHED: provisional pts replaced by persisted events, net total unchanged', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home } = await buildKoMatch('R32')

    await prisma.match.update({
      where: { id: match.id },
      data: { scoreHome: 2, scoreAway: 0, status: 'LIVE' },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: home.id, tripleActive: false },
    })

    const server = await buildServer()
    const liveRes = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    expect(liveRes.json<{ data: { total: number }[] }>().data[0].total).toBe(10)

    await prisma.match.update({
      where: { id: match.id },
      data: { status: 'FINISHED', winnerTeamId: home.id },
    })
    await persistKoMatchScoreEvents(match.id)

    const finishedRes = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    expect(finishedRes.json<{ data: { total: number }[] }>().data[0].total).toBe(10)
  })

  it('disappointment team wins → negative pts via persistPowerupKoMatchEvents', async () => {
    await seedScoringParams({ pts_disappointment_per_round: 5, pts_dark_horse_per_round: 8 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, home, away } = await buildKoMatch('R32')

    await prisma.powerup.create({
      data: {
        participantId: participant.id,
        darkHorseTeamId: away.id,      // dark horse loses
        disappointmentTeamId: home.id, // disappointment wins
      },
    })
    await prisma.match.update({
      where: { id: match.id },
      data: { winnerTeamId: home.id, status: 'FINISHED' },
    })

    await persistPowerupKoMatchEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = res.json<{ data: { total: number }[] }>().data[0]
    expect(entry.total).toBe(-5)
  })
})
