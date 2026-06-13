import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { MatchBuilder } from '../builders/match.builder.js'
import type { WorldCupMatch } from '../../types/worldcup-api.types.js'

const { mockGetMatch } = vi.hoisted(() => ({
  mockGetMatch: vi.fn(),
}))

vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getMatch: mockGetMatch },
}))

function apiGame(overrides: Partial<WorldCupMatch> = {}): WorldCupMatch {
  return {
    _id: '679c9c8a5749c4077500e004',
    id: '4',
    home_team_id: '13',
    away_team_id: '14',
    home_score: '0',
    away_score: '0',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'D',
    matchday: '1',
    stadium_id: '16',
    local_date: '06/12/2026 18:00',
    finished: 'FALSE',
    time_elapsed: 'notstarted',
    type: 'group',
    ...overrides,
  }
}

describe('POST /admin/matches/resync-schedules', () => {
  beforeEach(() => {
    mockGetMatch.mockReset()
  })

  it('recomputes scheduledAt from venue timezone for matches with externalMatchId', async () => {
    const { cookie } = await createAuthenticatedAdmin()

    // Loaded with the old buggy time (local_date treated as UTC).
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('4')
      .withScheduledAt(new Date('2026-06-12T18:00:00.000Z'))
      .withAdditionalData({ stadiumName: 'SoFi Stadium' })
      .build()

    mockGetMatch.mockResolvedValue(apiGame())

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/matches/resync-schedules',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ updated: 1, total: 1 })

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    // SoFi (stadium 16, LA PDT UTC-7): 18:00 local → 01:00Z next day.
    expect(updated?.scheduledAt.toISOString()).toBe('2026-06-13T01:00:00.000Z')
    // Stadium info preserved.
    expect(updated?.additionalData).toMatchObject({ stadiumName: 'SoFi Stadium' })
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/matches/resync-schedules' })
    expect(res.statusCode).toBe(401)
  })

  it('non-admin → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/matches/resync-schedules',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
  })
})
