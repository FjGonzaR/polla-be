import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'

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

    // p1: 100 pts, p2: 100 pts (tiebreak: p2 has 2 exact KO scores vs p1's 1), p3: 50 pts
    await prisma.scoreEvent.createMany({
      data: [
        { participantId: p1.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 100 },
        { participantId: p2.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 100 },
        { participantId: p3.id, paramKey: 'pts_group_position_exact', matchId: null, groupId: null, roundSlug: null, points: 50 },
      ],
    })

    // Give p2 2 exact KO scores and p1 1 exact KO score via KoPredictions
    const round = await prisma.round.create({
      data: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
    })
    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const team = await prisma.team.create({
      data: { name: 'Team X', code: 'TXX', groupId: group.id },
    })
    const match1 = await prisma.match.create({
      data: { roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-01'), scoreHome: 2, scoreAway: 1, status: 'FINISHED', winnerTeamId: team.id, homeTeamId: team.id },
    })
    const match2 = await prisma.match.create({
      data: { roundId: round.id, matchNumber: 2, scheduledAt: new Date('2026-07-02'), scoreHome: 0, scoreAway: 0, status: 'FINISHED', winnerTeamId: team.id, homeTeamId: team.id },
    })

    // p1: 1 exact KO score (match1 only)
    await prisma.koPrediction.createMany({
      data: [
        { participantId: p1.id, matchId: match1.id, scoreHome: 2, scoreAway: 1, teamAdvancesId: team.id, tripleActive: false },
      ],
    })
    // p2: 2 exact KO scores
    await prisma.koPrediction.createMany({
      data: [
        { participantId: p2.id, matchId: match1.id, scoreHome: 2, scoreAway: 1, teamAdvancesId: team.id, tripleActive: false },
        { participantId: p2.id, matchId: match2.id, scoreHome: 0, scoreAway: 0, teamAdvancesId: team.id, tripleActive: false },
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
})
