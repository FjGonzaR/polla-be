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
  recalculateParticipantScores,
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
    scale_group: 1,
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

  it('dark horse qualifies (1st) → breakdown.darkHorse = base * scale_group', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, pts_disappointment_per_round: 5, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group G1', label: 'G' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DH1', code: 'DH1', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DP1', code: 'DP1', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 1, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 4, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    await persistPowerupGroupEvents()

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })

    const body = res.json()
    expect(body.breakdown.darkHorse).toBe(8) // 8 * scale_group(1)
    expect(body.breakdown.disappointment).toBe(0) // finished 4th → did not qualify
    expect(body.total).toBe(8)
  })

  it('disappointment team at realPosition=1 with matchesPlayed=0 (pre-tournament standings) → disappointment = 0', async () => {
    await seedScoringParams({ pts_disappointment_per_round: 5, pts_dark_horse_per_round: 8, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group PT', label: 'T' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DHt', code: 'DHT', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DPt', code: 'DPT', groupId: grp.id } })
    // sync-standings assigns realPosition before any match is played
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 3, matchesPlayed: 0 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 1, matchesPlayed: 0 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    const body = res.json()
    expect(body.breakdown.disappointment).toBe(0)
    expect(body.breakdown.darkHorse).toBe(0)
    expect(body.total).toBe(0)
  })

  it('group rung shows provisionally in breakdown before persistence (matches scoreboard)', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, pts_disappointment_per_round: 5, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group PB', label: 'X' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DHx', code: 'DHX', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DPx', code: 'DPX', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 1, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 2, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    // No persistPowerupGroupEvents yet → values come from the provisional path.
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    const body = res.json()
    expect(body.breakdown.darkHorse).toBe(8) // 8 * scale_group(1)
    expect(body.breakdown.disappointment).toBe(-5) // both qualified
    expect(body.total).toBe(3) // 8 - 5

    // Scoreboard total agrees with breakdown total
    const sb = await server.inject({ method: 'GET', url: '/scoreboard', headers: { cookie } })
    const entry = sb.json<{ data: { participant: { id: string }; total: number }[] }>().data.find((e) => e.participant.id === participant.id)
    expect(entry!.total).toBe(3)
  })

  it('dark horse 3rd: group rung only when selected as qualified third', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group G2', label: 'H' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DH2', code: 'DH2', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DP2', code: 'DP2', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 3, qualifiedAsThird: false, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 1, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    await persistPowerupGroupEvents()
    const server = await buildServer()
    let res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    expect(res.json().breakdown.darkHorse).toBe(0) // 3rd, not selected → no rung

    await prisma.groupStanding.update({ where: { teamId: darkHorse.id }, data: { qualifiedAsThird: true } })
    await persistPowerupGroupEvents()
    res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    expect(res.json().breakdown.darkHorse).toBe(8) // now a qualified third → rung awarded
  })

  it('disappointment qualifies → breakdown.disappointment = -(base * scale_group)', async () => {
    await seedScoringParams({ pts_disappointment_per_round: 5, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group G3', label: 'I' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DH3', code: 'DH3', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DP3', code: 'DP3', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 4, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 2, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    await persistPowerupGroupEvents()
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })

    const body = res.json()
    expect(body.breakdown.disappointment).toBe(-5)
    expect(body.breakdown.darkHorse).toBe(0)
    expect(body.total).toBe(-5)
  })

  it('dark horse qualifies + wins R32 → group rung + advance rung', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, scale_group: 1, scale_r32: 2 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group G4', label: 'J' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DH4', code: 'DH4', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DP4', code: 'DP4', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 2, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 4, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'),
        homeTeamId: darkHorse.id, awayTeamId: disappoint.id,
        winnerTeamId: darkHorse.id, status: 'FINISHED',
      },
    })

    await persistPowerupGroupEvents()
    await persistPowerupKoMatchEvents(match.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })

    // group rung 8*1 + R32 advance 8*2 = 24
    expect(res.json().breakdown.darkHorse).toBe(24)
  })

  it('recalculateParticipantScores reproduces the group rung', async () => {
    await seedScoringParams({ pts_dark_horse_per_round: 8, scale_group: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()

    const grp = await prisma.group.create({ data: { name: 'Group G5', label: 'K' } })
    const darkHorse = await prisma.team.create({ data: { name: 'DH5', code: 'DH5', groupId: grp.id } })
    const disappoint = await prisma.team.create({ data: { name: 'DP5', code: 'DP5', groupId: grp.id } })
    await prisma.groupStanding.create({ data: { teamId: darkHorse.id, groupId: grp.id, realPosition: 1, matchesPlayed: 3 } })
    await prisma.groupStanding.create({ data: { teamId: disappoint.id, groupId: grp.id, realPosition: 3, qualifiedAsThird: false, matchesPlayed: 3 } })
    await prisma.powerup.create({
      data: { participantId: participant.id, darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappoint.id },
    })

    await recalculateParticipantScores(participant.id)

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    expect(res.json().breakdown.darkHorse).toBe(8)
    expect(res.json().breakdown.disappointment).toBe(0)
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
