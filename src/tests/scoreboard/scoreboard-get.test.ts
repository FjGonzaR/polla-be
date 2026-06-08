import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import {
  persistGroupScoreEvents,
  persistKoMatchScoreEvents,
  persistPowerupKoMatchEvents,
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
    const data = res.json<{ rank: number; totalPoints: number; participant: { name: string } }[]>()
    expect(data.length).toBe(2)
    expect(data.every((e) => e.totalPoints === 0)).toBe(true)
    expect(data.every((e) => e.rank === 1)).toBe(true)
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
    const data = res.json<{ rank: number; totalPoints: number; participant: { name: string }; prize: number | null; exactKoScores: number }[]>()

    expect(data[0].participant.name).toBe('Beta')
    expect(data[0].rank).toBe(1)
    expect(data[0].totalPoints).toBe(100)
    expect(data[0].exactKoScores).toBe(2)
    expect(data[0].prize).toBe(700000)

    expect(data[1].participant.name).toBe('Alpha')
    expect(data[1].rank).toBe(2)
    expect(data[1].exactKoScores).toBe(1)
    expect(data[1].prize).toBe(250000)

    expect(data[2].participant.name).toBe('Gamma')
    expect(data[2].rank).toBe(3)
    expect(data[2].totalPoints).toBe(50)
    expect(data[2].prize).toBe(50000)
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
    const data = res.json<{ rank: number }[]>()
    expect(data.every((e) => e.rank === 1)).toBe(true)
  })

  // ── scoring pipeline ────────────────────────────────────────────────────

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
    const entry = res.json<{ totalPoints: number }[]>().find((e) => true)
    expect(entry?.totalPoints).toBe(4 * 3 + 5) // 17
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    expect(entry.totalPoints).toBe(2 * 3) // 6, no bonus
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    // (4 + 6) * scale_r32(1) = 10
    expect(entry.totalPoints).toBe(10)
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    // (4 + 6) * 1 + 3 = 13
    expect(entry.totalPoints).toBe(13)
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    expect(entry.totalPoints).toBe(0)
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    expect(entry.totalPoints).toBe(8)
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
    const entry = res.json<{ totalPoints: number }[]>()[0]
    expect(entry.totalPoints).toBe(-5)
  })
})
