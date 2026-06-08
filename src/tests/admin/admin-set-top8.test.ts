import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'

async function buildTop8Candidates() {
  const group = await new GroupBuilder().withLabel('Z').withName('Group Z').build()
  const teams = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      new TeamBuilder()
        .withName(`Team ${i}`)
        .withCode(`T${i}0`)
        .withGroupId(group.id)
        .withIsTop8(false)
        .build(),
    ),
  )
  return teams
}

describe('PUT /admin/top8', () => {
  it('success → 200 + isTop8 updated in DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTop8Candidates()
    const teamIds = teams.map((t) => t.id)

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      headers: { cookie },
      payload: { teamIds },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.teams).toHaveLength(8)
    expect(body.teams[0].flag).toBe('https://flagcdn.com/w80/xx.png')

    const updated = await prisma.team.findMany({ where: { id: { in: teamIds } } })
    expect(updated.every((t) => t.isTop8)).toBe(true)
  })

  it('idempotent — calling twice switches top8 correctly', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTop8Candidates()
    const teamIds = teams.map((t) => t.id)

    const server = await buildServer()
    await server.inject({ method: 'PUT', url: '/admin/top8', headers: { cookie }, payload: { teamIds } })

    const firstFour = teamIds.slice(0, 8)
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      headers: { cookie },
      payload: { teamIds: firstFour },
    })

    expect(res.statusCode).toBe(200)
    const top8inDb = await prisma.team.findMany({ where: { isTop8: true } })
    expect(top8inDb).toHaveLength(8)
  })

  it('not 8 IDs → 400 INVALID_TOP8_COUNT', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      headers: { cookie },
      payload: { teamIds: ['a', 'b', 'c'] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_TOP8_COUNT')
  })

  it('unknown team ID → 404 TEAM_NOT_FOUND', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const fakeIds = Array.from({ length: 8 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`)
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      headers: { cookie },
      payload: { teamIds: fakeIds },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('TEAM_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      payload: { teamIds: [] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/top8',
      headers: { cookie },
      payload: { teamIds: [] },
    })
    expect(res.statusCode).toBe(403)
  })
})
