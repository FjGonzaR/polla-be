import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { createAuthenticatedAdmin, createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildInvitation } from '../builders/invitation.builder.js'
import { InvitationStatus } from '@prisma/client'

describe('GET /admin/invitations', () => {
  it('success (no filter) → 200 + all invitations', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildInvitation({ status: InvitationStatus.AVAILABLE })
    await buildInvitation({ status: InvitationStatus.USED, usedAt: new Date() })
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('status=AVAILABLE filter → only AVAILABLE invitations', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildInvitation({ status: InvitationStatus.AVAILABLE })
    await buildInvitation({ status: InvitationStatus.USED, usedAt: new Date() })
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/admin/invitations?status=AVAILABLE',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.every((inv: { status: string }) => inv.status === 'AVAILABLE')).toBe(true)
  })

  it('status=USED filter → only USED invitations', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    await buildInvitation({ status: InvitationStatus.AVAILABLE })
    await buildInvitation({ status: InvitationStatus.USED, usedAt: new Date() })
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/admin/invitations?status=USED',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.every((inv: { status: string }) => inv.status === 'USED')).toBe(true)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/invitations' })
    expect(res.statusCode).toBe(401)
  })

  it('non-admin participant → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/admin/invitations',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(403)
  })
})
