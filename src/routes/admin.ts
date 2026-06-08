import type { FastifyInstance } from 'fastify'
import { InvitationStatus } from '@prisma/client'
import { createInvitation, listInvitations } from '../services/invitation.service.js'
import {
  setMatchResult,
  updateScoringParam,
  setQualifiedThirds,
} from '../services/admin.service.js'

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)
  fastify.addHook('preHandler', fastify.requireAdmin)

  fastify.post('/invitations', async (_request, reply) => {
    const inv = await createInvitation()
    return reply.code(201).send(inv)
  })

  fastify.get('/invitations', async (request, reply) => {
    const { status, page, pageSize } = request.query as {
      status?: string
      page?: string
      pageSize?: string
    }
    const statusFilter =
      status && Object.values(InvitationStatus).includes(status as InvitationStatus)
        ? (status as InvitationStatus)
        : undefined
    const result = await listInvitations(
      statusFilter,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    )
    return reply.code(200).send(result)
  })

  fastify.put('/ko/matches/:matchId/result', async (request, reply) => {
    const { matchId } = request.params as { matchId: string }
    const body = request.body as { scoreHome: number; scoreAway: number; winnerTeamId: string }
    await setMatchResult(matchId, body)
    return reply.code(200).send({ ok: true })
  })

  fastify.put('/groups/thirds', async (request, reply) => {
    const { teamIds } = request.body as { teamIds: string[] }
    await setQualifiedThirds(teamIds)
    return reply.code(200).send({ ok: true })
  })

  fastify.put('/scoring-params/:key', async (request, reply) => {
    const { key } = request.params as { key: string }
    const { value } = request.body as { value: number }
    const data = await updateScoringParam(key, value)
    return reply.code(200).send(data)
  })
}
