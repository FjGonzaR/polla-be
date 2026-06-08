import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'

async function buildMatchWithTeams() {
  const round = await prisma.round.create({
    data: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
  })
  const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
  const home = await prisma.team.create({ data: { name: 'Home FC', code: 'HFC', groupId: group.id } })
  const away = await prisma.team.create({ data: { name: 'Away FC', code: 'AFC', groupId: group.id } })
  const match = await prisma.match.create({
    data: {
      roundId: round.id,
      matchNumber: 1,
      scheduledAt: new Date('2026-07-01T18:00:00Z'),
      homeTeamId: home.id,
      awayTeamId: away.id,
    },
  })
  return { match, home, away }
}

describe('PUT /admin/ko/matches/:matchId/result', () => {
  it('sets result, marks FINISHED, triggers score recalculation → 200', async () => {
    await seedScoringParams()
    const { cookie } = await createAuthenticatedAdmin()
    const { match, home } = await buildMatchWithTeams()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/ko/matches/${match.id}/result`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, winnerTeamId: home.id },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.matchId).toBe(match.id)
    expect(body.scoreHome).toBe(2)
    expect(body.scoreAway).toBe(1)
    expect(body.winnerTeamId).toBe(home.id)

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.scoreHome).toBe(2)
    expect(updated?.scoreAway).toBe(1)
    expect(updated?.winnerTeamId).toBe(home.id)
    expect(updated?.status).toBe('FINISHED')
  })

  it('winnerTeamId not in match → 400 INVALID_WINNER', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const { match } = await buildMatchWithTeams()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/ko/matches/${match.id}/result`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, winnerTeamId: 'non-existent-id' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_WINNER')
  })

  it('match not found → 404', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/ko/matches/00000000-0000-0000-0000-000000000000/result',
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, winnerTeamId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/ko/matches/some-id/result',
      payload: { scoreHome: 1, scoreAway: 0, winnerTeamId: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/ko/matches/some-id/result',
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, winnerTeamId: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})
