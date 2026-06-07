import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'

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
    expect(body.groups).toBe(0)
    expect(body.thirds).toBe(0)
    expect(body.ko).toBe(0)
    expect(body.darkHorse).toBe(0)
    expect(body.disappointment).toBe(0)
    expect(body.total).toBe(0)
    expect(body.tripleUsesRemaining).toBe(3)
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
    expect(body.groups).toBe(17)       // 12 + 5
    expect(body.thirds).toBe(8)
    expect(body.ko).toBe(28)           // 10 + 15 + 3
    expect(body.darkHorse).toBe(7)
    expect(body.disappointment).toBe(-4)
    expect(body.total).toBe(56)        // 17 + 8 + 28 + 7 + (-4)
    expect(body.tripleUsesRemaining).toBe(3)
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
    expect(res.json().participant.id).toBe(other.id)
  })
})
