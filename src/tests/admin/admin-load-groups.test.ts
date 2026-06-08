import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'

function buildGroupsPayload(count = 12, teamsPerGroup = 4) {
  let seq = 0
  return Array.from({ length: count }, (_, i) => ({
    label: String.fromCharCode(65 + i),
    name: `Group ${String.fromCharCode(65 + i)}`,
    lastMatchAt: null as string | null,
    teams: Array.from({ length: teamsPerGroup }, () => {
      const code = `X${String(seq).padStart(2, '0')}`
      seq++
      return { name: `Team ${seq}`, code, isTop8: false }
    }),
  }))
}

describe('POST /admin/groups', () => {
  it('success → 201 + groups and teams in DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { cookie },
      payload: { groups: buildGroupsPayload() },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().groupsCount).toBe(12)
    expect(res.json().teamsCount).toBe(48)

    const groupCount = await prisma.group.count()
    const teamCount = await prisma.team.count()
    expect(groupCount).toBe(12)
    expect(teamCount).toBe(48)
  })

  it('stores lastMatchAt when provided', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const groups = buildGroupsPayload()
    groups[0].lastMatchAt = '2026-06-25T22:00:00Z'

    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { cookie },
      payload: { groups },
    })

    expect(res.statusCode).toBe(201)
    const group = await prisma.group.findFirst({ where: { label: 'A' } })
    expect(group?.lastMatchAt).toEqual(new Date('2026-06-25T22:00:00Z'))
  })

  it('already loaded → 409 GROUPS_ALREADY_LOADED', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const payload = { groups: buildGroupsPayload() }

    await server.inject({ method: 'POST', url: '/admin/groups', headers: { cookie }, payload })
    const res = await server.inject({ method: 'POST', url: '/admin/groups', headers: { cookie }, payload })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('GROUPS_ALREADY_LOADED')
  })

  it('wrong group count → 400 INVALID_GROUPS_PAYLOAD', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { cookie },
      payload: { groups: buildGroupsPayload(10) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_GROUPS_PAYLOAD')
  })

  it('wrong team count → 400 INVALID_GROUPS_PAYLOAD', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { cookie },
      payload: { groups: buildGroupsPayload(12, 3) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_GROUPS_PAYLOAD')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      payload: { groups: buildGroupsPayload() },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { cookie },
      payload: { groups: buildGroupsPayload() },
    })
    expect(res.statusCode).toBe(403)
  })
})
