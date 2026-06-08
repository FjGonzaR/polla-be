import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedAdmin, createAuthenticatedParticipant } from '../helpers/auth.helper.js'

describe('POST /admin/invitations', () => {
  it('success → 201 + valid invitation in body and DB', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBeDefined()
    expect(body.code).toMatch(/^[A-Z]{4}[0-9]{4}$/)
    expect(body.status).toBe('AVAILABLE')
    expect(body.usedAt).toBeNull()
    expect(body.expiresAt).toBeDefined()
    expect(body.createdAt).toBeDefined()

    const expiresAt = new Date(body.expiresAt)
    const now = new Date()
    expect(expiresAt.getTime()).toBeGreaterThan(now.getTime())

    const row = await prisma.invitation.findUnique({ where: { id: body.id } })
    expect(row).not.toBeNull()
    expect(row!.code).toBe(body.code)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/invitations' })
    expect(res.statusCode).toBe(401)
  })

  it('non-admin participant → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(403)
  })
})
