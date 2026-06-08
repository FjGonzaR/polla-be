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
    data: Object.entries(params).map(([key, value]) => ({ key, value, description: key })),
  })
}

describe('GET /scoreboard/:participantId/breakdown', () => {
  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/scoreboard/some-id/breakdown' })
    expect(res.statusCode).toBe(401)
  })

  it('participant not found → 404', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/scoreboard/00000000-0000-0000-0000-000000000000/breakdown',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('PARTICIPANT_NOT_FOUND')
  })

  it('returns zeroed breakdown when no score events', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.participant.id).toBe(participant.id)
    expect(body.breakdown.groups).toBe(0)
    expect(body.breakdown.thirds).toBe(0)
    expect(body.breakdown.ko).toBe(0)
    expect(body.breakdown.darkHorse).toBe(0)
    expect(body.breakdown.disappointment).toBe(0)
    expect(body.total).toBe(0)
    expect(body.tripleUsesRemaining).toBe(3)
    expect(body.prize).toBe(700000) // only participant → rank 1
  })

  it('aggregates score events by category correctly', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()

    await prisma.scoreEvent.createMany({
      data: [
        { participantId: participant.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 12 },
        { participantId: participant.id, paramKey: 'bonus_group_complete', matchId: null, groupId: null, roundSlug: null, points: 5 },
        { participantId: participant.id, paramKey: 'pts_third_correct', matchId: null, groupId: null, roundSlug: null, points: 8 },
        { participantId: participant.id, paramKey: 'pts_ko_advances', matchId: null, groupId: null, roundSlug: 'R32', points: 10 },
        { participantId: participant.id, paramKey: 'pts_ko_exact_score', matchId: null, groupId: null, roundSlug: 'R32', points: 15 },
        { participantId: participant.id, paramKey: 'mult_triple', matchId: null, groupId: null, roundSlug: 'R32', points: 3 },
        { participantId: participant.id, paramKey: 'pts_dark_horse_per_round', matchId: null, groupId: null, roundSlug: 'R32', points: 7 },
        { participantId: participant.id, paramKey: 'pts_disappointment_per_round', matchId: null, groupId: null, roundSlug: 'R32', points: -4 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.breakdown.groups).toBe(17)       // 12 + 5
    expect(body.breakdown.thirds).toBe(8)
    expect(body.breakdown.ko).toBe(28)           // 10 + 15 + 3
    expect(body.breakdown.darkHorse).toBe(7)
    expect(body.breakdown.disappointment).toBe(-4)
    expect(body.total).toBe(56)                  // 17 + 8 + 28 + 7 + (-4)
    expect(body.tripleUsesRemaining).toBe(3)
    expect(body.prize).toBe(700000)              // only participant → rank 1
  })

  it('tripleUsesRemaining decreases with active triples', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const team = await prisma.team.create({ data: { name: 'Team A', code: 'TEA', groupId: group.id } })
    const match = await prisma.match.create({
      data: { roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'), homeTeamId: team.id },
    })

    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: team.id, tripleActive: true },
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().tripleUsesRemaining).toBe(2)
  })

  it('any participant can see any breakdown', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const other = await buildParticipant()

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${other.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.participant.id).toBe(other.id)
    expect(body.prize).toBeDefined()
  })

  // ── scoring pipeline ────────────────────────────────────────────────────

  it('group predictions: 4/4 exact → breakdown.groups = pts*4 + bonus', async () => {
    await seedScoringParams({ pts_group_position_exact: 3, bonus_group_complete: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const group = await prisma.group.create({
      data: { name: 'Group D', label: 'D', lastMatchAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    })
    const teams = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        prisma.team.create({ data: { name: `DT${i}`, code: `DT${i}`, groupId: group.id } }),
      ),
    )
    await prisma.groupStanding.createMany({
      data: teams.map((t, i) => ({ teamId: t.id, groupId: group.id, realPosition: i + 1, matchesPlayed: 3 })),
    })
    await prisma.groupPrediction.createMany({
      data: teams.map((t, i) => ({
        participantId: participant.id, groupId: group.id, teamId: t.id, predictedPosition: i + 1,
      })),
    })

    await persistGroupScoreEvents(group.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.breakdown.groups).toBe(4 * 3 + 5) // 17
    expect(body.breakdown.thirds).toBe(0)
    expect(body.breakdown.ko).toBe(0)
    expect(body.total).toBe(17)
  })

  it('KO advances only → breakdown.ko = pts_ko_advances * scale', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'KG', label: 'K' } })
    const home = await prisma.team.create({ data: { name: 'H', code: 'HHH', groupId: grp.id } })
    const away = await prisma.team.create({ data: { name: 'A', code: 'AAA', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'),
        homeTeamId: home.id, awayTeamId: away.id,
        scoreHome: 2, scoreAway: 1, winnerTeamId: home.id, status: 'FINISHED',
      },
    })
    // correct advances, wrong score
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 3, scoreAway: 0, teamAdvancesId: home.id, tripleActive: false },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    const body = res.json()
    expect(body.breakdown.ko).toBe(4) // only pts_ko_advances * scale_r32(1)
    expect(body.total).toBe(4)
  })

  it('KO triple active + exact score → breakdown.ko includes mult_triple', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'KG2', label: 'L' } })
    const home = await prisma.team.create({ data: { name: 'LH', code: 'LHH', groupId: grp.id } })
    const away = await prisma.team.create({ data: { name: 'LA', code: 'LAA', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 2, scheduledAt: new Date('2026-07-02'),
        homeTeamId: home.id, awayTeamId: away.id,
        scoreHome: 1, scoreAway: 0, winnerTeamId: home.id, status: 'FINISHED',
      },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: home.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    const body = res.json()
    // (4 + 6) * 1 = 10 scaled, + 3 triple bonus = 13
    expect(body.breakdown.ko).toBe(13)
  })

  it('KO triple active + wrong score → breakdown.ko = 0 (triple-or-nothing penalty)', async () => {
    await seedScoringParams({ pts_ko_advances: 4, pts_ko_exact_score: 6, mult_triple: 3, scale_r32: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'KG3', label: 'M' } })
    const home = await prisma.team.create({ data: { name: 'MH', code: 'MHH', groupId: grp.id } })
    const away = await prisma.team.create({ data: { name: 'MA', code: 'MAA', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 3, scheduledAt: new Date('2026-07-03'),
        homeTeamId: home.id, awayTeamId: away.id,
        scoreHome: 3, scoreAway: 0, winnerTeamId: home.id, status: 'FINISHED',
      },
    })
    // triple active, advances correct, score wrong
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: home.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    expect(res.json().breakdown.ko).toBe(0)
  })

  it('dark horse wins → breakdown.darkHorse = pts_dark_horse_per_round', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, pts_disappointment_per_round: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'PG', label: 'P' } })
    const darkHorse = await prisma.team.create({ data: { name: 'Dark', code: 'DRK', groupId: grp.id } })
    const other = await prisma.team.create({ data: { name: 'Other', code: 'OTH', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'),
        homeTeamId: darkHorse.id, awayTeamId: other.id,
        winnerTeamId: darkHorse.id, status: 'FINISHED',
      },
    })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: other.id },
    })

    await persistPowerupKoMatchEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    const body = res.json()
    expect(body.breakdown.darkHorse).toBe(8)
    expect(body.breakdown.disappointment).toBe(0)
    expect(body.total).toBe(8)
  })

  it('disappointment team wins → breakdown.disappointment is negative', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, pts_disappointment_per_round: 5 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'QG', label: 'Q' } })
    const disappoints = await prisma.team.create({ data: { name: 'Disappoint', code: 'DPP', groupId: grp.id } })
    const darkH = await prisma.team.create({ data: { name: 'DH', code: 'DHH', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'),
        homeTeamId: disappoints.id, awayTeamId: darkH.id,
        winnerTeamId: disappoints.id, status: 'FINISHED',
      },
    })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkH.id, disappointmentTeamId: disappoints.id },
    })

    await persistPowerupKoMatchEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/scoreboard/${participant.id}/breakdown`,
      headers: { cookie },
    })

    const body = res.json()
    expect(body.breakdown.disappointment).toBe(-5)
    expect(body.breakdown.darkHorse).toBe(0)
    expect(body.total).toBe(-5)
  })
})
