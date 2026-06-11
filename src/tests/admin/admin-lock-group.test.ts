import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { GroupBuilder } from '../builders/group.builder.js'

describe('PUT /admin/groups/:groupId/locked', () => {
  it('locked: true → 200 + lockedAt set in DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/groups/${group.id}/locked`,
      headers: { cookie },
      payload: { locked: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)

    const updated = await prisma.group.findUnique({ where: { id: group.id } })
    expect(updated?.lockedAt).not.toBeNull()
  })

  it('locked: false → 200 + lockedAt cleared in DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const group = await new GroupBuilder()
      .withLabel('A')
      .withName('Group A')
      .withLockedAt(new Date(Date.now() - 1000))
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: `/admin/groups/${group.id}/locked`,
      headers: { cookie },
      payload: { locked: false },
    })

    expect(res.statusCode).toBe(200)
    const updated = await prisma.group.findUnique({ where: { id: group.id } })
    expect(updated?.lockedAt).toBeNull()
  })

  it('unknown groupId → 404 GROUP_NOT_FOUND', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/00000000-0000-0000-0000-000000000000/locked',
      headers: { cookie },
      payload: { locked: true },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('GROUP_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/some-id/locked',
      payload: { locked: true },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/some-id/locked',
      headers: { cookie },
      payload: { locked: true },
    })
    expect(res.statusCode).toBe(403)
  })
})
