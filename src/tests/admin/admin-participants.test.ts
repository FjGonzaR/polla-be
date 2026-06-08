import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'

describe('GET /admin/participants', () => {
  it('success → 200 + list with all participants and totalScore', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const { participant: p1 } = await createAuthenticatedParticipant({ name: 'Alice', email: 'alice@test.com', phone: '+573001111111' })
    const { participant: p2 } = await createAuthenticatedParticipant({ name: 'Bob', email: 'bob@test.com' })

    const scoringParam = await prisma.scoringParam.create({
      data: { key: 'pts_ko_advances', value: 3, description: 'test' },
    })
    await prisma.scoreEvent.create({
      data: { participantId: p1.id, paramKey: scoringParam.key, points: 10, matchId: null },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/participants', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(Array.isArray(data)).toBe(true)

    const alice = data.find((p: { name: string }) => p.name === 'Alice')
    expect(alice).toBeDefined()
    expect(alice.email).toBe('alice@test.com')
    expect(alice.phone).toBe('+573001111111')
    expect(alice.totalScore).toBe(10)

    const bob = data.find((p: { name: string }) => p.name === 'Bob')
    expect(bob).toBeDefined()
    expect(bob.totalScore).toBe(0)
  })

  it('only admin, no other participants → 200 + array with just the admin', async () => {
    const { cookie, participant: admin } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/participants', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(admin.id)
    expect(data[0].totalScore).toBe(0)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/participants' })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/participants', headers: { cookie } })
    expect(res.statusCode).toBe(403)
  })
})
