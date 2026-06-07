import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { buildInvitation } from '../builders/invitation.builder.js'
import { buildParticipant } from '../builders/participant.builder.js'

describe('POST /admin/invitations', () => {
  it('creates N invitations and returns them → 201', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const server = await buildServer()

    const res = await server.inject({
      method: 'POST',
      url: '/admin/invitations',
      headers: { cookie },
      payload: { count: 3 },
    })

    expect(res.statusCode).toBe(201)
    const { data } = res.json<{ data: { code: string; status: string }[] }>()
    expect(data).toHaveLength(3)
    expect(data.every((i) => i.status === 'AVAILABLE')).toBe(true)

    const inDB = await prisma.invitation.count({ where: { code: { in: data.map((d) => d.code) } } })
    expect(inDB).toBe(3)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/invitations', payload: { count: 1 } })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/admin/invitations', headers: { cookie }, payload: { count: 1 } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /admin/invitations', () => {
  it('returns all invitations including used ones with participant info → 200', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const inv = await buildInvitation({ status: 'USED' })
    const participant = await buildParticipant({ invitationId: inv.id })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/invitations', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json<{ data: { code: string; participant: { name: string } | null }[] }>()
    const found = data.find((i) => i.code === inv.code)
    expect(found).toBeDefined()
    expect(found?.participant?.name).toBe(participant.name)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/invitations' })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/admin/invitations', headers: { cookie } })
    expect(res.statusCode).toBe(403)
  })
})
