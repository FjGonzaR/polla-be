import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'

async function buildScoringParam(key = 'pts_ko_advances', value = 5) {
  return prisma.scoringParam.create({
    data: { key, value, description: 'Points for advancing team correct' },
  })
}

describe('PUT /admin/scoring-params/:key', () => {
  it('updates value → 200, DB updated', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildScoringParam('pts_ko_advances', 5)

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/scoring-params/pts_ko_advances',
      headers: { cookie },
      payload: { value: 10 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().key).toBe('pts_ko_advances')
    expect(res.json().value).toBe(10)

    const row = await prisma.scoringParam.findUnique({ where: { key: 'pts_ko_advances' } })
    expect(Number(row?.value)).toBe(10)
  })

  it('key not found → 404', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/scoring-params/non_existent_key',
      headers: { cookie },
      payload: { value: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/scoring-params/pts_ko_advances',
      payload: { value: 1 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/scoring-params/pts_ko_advances',
      headers: { cookie },
      payload: { value: 1 },
    })
    expect(res.statusCode).toBe(403)
  })
})
