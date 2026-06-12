import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { RoundBuilder } from '../builders/round.builder.js'
import type { WorldCupMatch, WorldCupStadium } from '../../types/worldcup-api.types.js'

const { mockGetMatch, mockGetStadium } = vi.hoisted(() => ({
  mockGetMatch: vi.fn(),
  mockGetStadium: vi.fn(),
}))

vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getMatch: mockGetMatch, getStadium: mockGetStadium },
}))

function apiGame(overrides: Partial<WorldCupMatch> = {}): WorldCupMatch {
  return {
    _id: '679c9c8a5749c4077500e073',
    id: '73',
    home_team_id: 'ext-home',
    away_team_id: 'ext-away',
    home_score: '0',
    away_score: '0',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'R32',
    matchday: '4',
    stadium_id: '16',
    local_date: '06/28/2026 12:00',
    finished: 'FALSE',
    time_elapsed: 'notstarted',
    type: 'r32',
    ...overrides,
  }
}

function apiStadium(): WorldCupStadium {
  return {
    _id: '679c9c8a5749c4077500f016',
    id: '16',
    name_en: 'SoFi Stadium',
    city_en: 'Los Angeles (Inglewood)',
    country_en: 'United States',
    capacity: 70000,
  }
}

function buildMatchesPayload() {
  return [
    {
      externalMatchId: 'ext-001',
      matchNumber: 1,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamLabel: 'Winner Group A',
      awayTeamLabel: 'Runner-up Group B',
      scheduledAt: '2026-07-01T18:00:00Z',
    },
    {
      externalMatchId: 'ext-002',
      matchNumber: 2,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamLabel: 'Winner Group C',
      awayTeamLabel: 'Runner-up Group D',
      scheduledAt: '2026-07-02T18:00:00Z',
    },
  ]
}

describe('POST /admin/ko/matches', () => {
  beforeEach(() => {
    mockGetMatch.mockReset()
    mockGetStadium.mockReset()
  })

  it('success → 201 + matches in DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await new RoundBuilder().withSlug('R32').build()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: { roundSlug: 'R32', matches: buildMatchesPayload() },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().roundSlug).toBe('R32')
    expect(res.json().matchesCount).toBe(2)

    const count = await prisma.match.count()
    expect(count).toBe(2)

    const match = await prisma.match.findFirst({ where: { externalMatchId: 'ext-001' } })
    expect(match?.homeTeamLabel).toBe('Winner Group A')
    expect(match?.awayTeamLabel).toBe('Runner-up Group B')
  })

  it('idempotent — calling twice upserts, no duplicate rows', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await new RoundBuilder().withSlug('R32').build()
    const server = await buildServer()
    const payload = { roundSlug: 'R32', matches: buildMatchesPayload() }

    await server.inject({ method: 'POST', url: '/admin/ko/matches', headers: { cookie }, payload })
    const res = await server.inject({ method: 'POST', url: '/admin/ko/matches', headers: { cookie }, payload })

    expect(res.statusCode).toBe(201)
    const count = await prisma.match.count()
    expect(count).toBe(2)
  })

  it('API-fetch mode — only externalMatchId provided → fetches from external API', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await new RoundBuilder().withSlug('R32').build()

    const group = await prisma.group.create({ data: { label: 'A', name: 'Group A' } })
    await prisma.team.create({
      data: { name: 'Home FC', code: 'HOM', groupId: group.id, externalTeamId: 'ext-home' },
    })
    await prisma.team.create({
      data: { name: 'Away FC', code: 'AWY', groupId: group.id, externalTeamId: 'ext-away' },
    })

    mockGetMatch.mockResolvedValue(apiGame({ home_scorers: '{"J. Quiñones 9\'"}', away_scorers: 'null' }))
    mockGetStadium.mockResolvedValue(apiStadium())

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: { roundSlug: 'R32', matches: [{ externalMatchId: '73' }] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().matchesCount).toBe(1)

    const match = await prisma.match.findFirst({ where: { externalMatchId: '73' } })
    expect(match).not.toBeNull()
    expect(match?.homeTeamId).not.toBeNull()
    expect(match?.awayTeamId).not.toBeNull()
    expect(match?.additionalData).toMatchObject({
      homeScorers: '{"J. Quiñones 9\'"}',
      awayScorers: 'null',
      stadiumName: 'SoFi Stadium',
      stadiumCity: 'Los Angeles (Inglewood)',
      stadiumCountry: 'United States',
      stadiumCapacity: 70000,
    })
  })

  it('API-fetch mode TBD match — home_team_id=0 → uses team labels from API', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await new RoundBuilder().withSlug('R32').build()

    mockGetMatch.mockResolvedValue(
      apiGame({
        home_team_id: '0',
        away_team_id: '0',
        home_team_label: 'Runner-up Group A',
        away_team_label: 'Runner-up Group B',
      }),
    )
    mockGetStadium.mockResolvedValue(apiStadium())

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: { roundSlug: 'R32', matches: [{ externalMatchId: '73' }] },
    })

    expect(res.statusCode).toBe(201)

    const match = await prisma.match.findFirst({ where: { externalMatchId: '73' } })
    expect(match?.homeTeamId).toBeNull()
    expect(match?.awayTeamId).toBeNull()
    expect(match?.homeTeamLabel).toBe('Runner-up Group A')
    expect(match?.awayTeamLabel).toBe('Runner-up Group B')
  })

  it('GROUP round — loads group matches that do not appear in KO listings', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await new RoundBuilder().withSlug('GROUP').withName('Group Phase').withOrder(0).withMatchCount(48).build()

    const group = await prisma.group.create({ data: { label: 'A', name: 'Group A' } })
    const home = await prisma.team.create({ data: { name: 'Home FC', code: 'HOM', groupId: group.id } })
    const away = await prisma.team.create({ data: { name: 'Away FC', code: 'AWY', groupId: group.id } })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: {
        roundSlug: 'GROUP',
        matches: [
          {
            externalMatchId: 'ext-g001',
            matchNumber: 1,
            homeTeamId: home.id,
            awayTeamId: away.id,
            scheduledAt: '2026-06-11T18:00:00Z',
          },
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().roundSlug).toBe('GROUP')
    expect(res.json().matchesCount).toBe(1)

    const match = await prisma.match.findFirst({ where: { externalMatchId: 'ext-g001' } })
    expect(match).not.toBeNull()
    expect(match?.homeTeamId).toBe(home.id)
    expect(match?.awayTeamId).toBe(away.id)
  })

  it('unknown round slug → 404 ROUND_NOT_FOUND', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: { roundSlug: 'QF', matches: buildMatchesPayload() },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('ROUND_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      payload: { roundSlug: 'R32', matches: [] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/ko/matches',
      headers: { cookie },
      payload: { roundSlug: 'R32', matches: [] },
    })
    expect(res.statusCode).toBe(403)
  })
})
