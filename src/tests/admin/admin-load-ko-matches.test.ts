import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { RoundBuilder } from '../builders/round.builder.js'

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
