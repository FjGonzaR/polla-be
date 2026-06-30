import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { MatchBuilder } from '../builders/match.builder.js'

async function buildTeam(name: string, code: string) {
  const group = await prisma.group.create({ data: { name: `Group ${code}`, label: code } })
  return prisma.team.create({ data: { name, code, groupId: group.id } })
}

describe('POST /admin/ko/bracket/link', () => {
  it('wires source matches into downstream slots → 200', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    // Feeders for R16 match 89: winner of 74 (home), winner of 77 (away)
    const m74 = await new MatchBuilder().withRoundSlug('R32').withMatchNumber(74).build()
    const m77 = await new MatchBuilder().withRoundSlug('R32').withMatchNumber(77).build()
    const m89 = await new MatchBuilder().withRoundSlug('R16').withMatchNumber(89).build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/bracket/link',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().linked).toBeGreaterThanOrEqual(1)

    const linked = await prisma.match.findUnique({ where: { id: m89.id } })
    expect(linked?.homeSourceMatchId).toBe(m74.id)
    expect(linked?.homeSourceOutcome).toBe('WINNER')
    expect(linked?.awaySourceMatchId).toBe(m77.id)
    expect(linked?.awaySourceOutcome).toBe('WINNER')
  })

  it('skips entries whose feeders are not loaded yet', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    // Only the target loaded, no feeders → must be skipped, not error
    await new MatchBuilder().withRoundSlug('R16').withMatchNumber(89).build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/bracket/link',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().linked).toBe(0)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/ko/bracket/link' })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/bracket/link',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('result propagation through the bracket', () => {
  it('advances the winner into the downstream home slot', async () => {
    await seedScoringParams()
    const { cookie } = await createAuthenticatedAdmin()
    const home = await buildTeam('Home FC', 'HME')
    const away = await buildTeam('Away FC', 'AWY')

    const m74 = await new MatchBuilder()
      .withRoundSlug('R32')
      .withMatchNumber(74)
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withScheduledAt(new Date('2026-06-29T18:00:00Z'))
      .build()
    const m89 = await new MatchBuilder()
      .withRoundSlug('R16')
      .withMatchNumber(89)
      .withHomeSource(m74.id, 'WINNER')
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/ko/matches/${m74.id}/result`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, winnerTeamId: home.id },
    })

    expect(res.statusCode).toBe(200)
    const updated = await prisma.match.findUnique({ where: { id: m89.id } })
    expect(updated?.homeTeamId).toBe(home.id)
  })

  it('advances the loser into a LOSER slot (third place)', async () => {
    await seedScoringParams()
    const { cookie } = await createAuthenticatedAdmin()
    const home = await buildTeam('SF Home', 'SFH')
    const away = await buildTeam('SF Away', 'SFA')

    const m101 = await new MatchBuilder()
      .withRoundSlug('SF')
      .withMatchNumber(101)
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withScheduledAt(new Date('2026-07-14T18:00:00Z'))
      .build()
    const m103 = await new MatchBuilder()
      .withRoundSlug('THIRD')
      .withMatchNumber(103)
      .withHomeSource(m101.id, 'LOSER')
      .build()
    const m104 = await new MatchBuilder()
      .withRoundSlug('FINAL')
      .withMatchNumber(104)
      .withHomeSource(m101.id, 'WINNER')
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/ko/matches/${m101.id}/result`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, winnerTeamId: home.id },
    })

    expect(res.statusCode).toBe(200)
    const third = await prisma.match.findUnique({ where: { id: m103.id } })
    const final = await prisma.match.findUnique({ where: { id: m104.id } })
    expect(third?.homeTeamId).toBe(away.id) // loser
    expect(final?.homeTeamId).toBe(home.id) // winner
  })
})

describe('GET /ko/matches exposes bracket sources', () => {
  it('returns homeSource / awaySource for an empty downstream slot', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const m74 = await new MatchBuilder().withRoundSlug('R32').withMatchNumber(74).build()
    const m77 = await new MatchBuilder().withRoundSlug('R32').withMatchNumber(77).build()
    await new MatchBuilder()
      .withRoundSlug('R16')
      .withMatchNumber(89)
      .withHomeSource(m74.id, 'WINNER')
      .withAwaySource(m77.id, 'WINNER')
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R16',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const match = res.json().matches.find((m: { matchNumber: number }) => m.matchNumber === 89)
    expect(match.homeTeam).toBeNull()
    expect(match.homeSource).toEqual({ matchId: m74.id, matchNumber: 74, outcome: 'WINNER' })
    expect(match.awaySource).toEqual({ matchId: m77.id, matchNumber: 77, outcome: 'WINNER' })
  })
})
