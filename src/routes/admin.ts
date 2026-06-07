import type { FastifyInstance } from 'fastify'
import {
  createInvitations,
  listInvitations,
  setMatchResult,
  updateScoringParam,
} from '../services/admin.service.js'

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)
  fastify.addHook('preHandler', fastify.requireAdmin)

  fastify.post('/invitations', async (request, reply) => {
    const { count } = request.body as { count: number }
    const data = await createInvitations(count)
    return reply.code(201).send({ data })
  })

  fastify.get('/invitations', async (_request, reply) => {
    const data = await listInvitations()
    return reply.code(200).send({ data })
  })

  fastify.put('/ko/matches/:matchId/result', async (request, reply) => {
    const { matchId } = request.params as { matchId: string }
    const body = request.body as { scoreHome: number; scoreAway: number; winnerTeamId: string }
    await setMatchResult(matchId, body)
    return reply.code(200).send({ ok: true })
  })

  fastify.put('/scoring-params/:key', async (request, reply) => {
    const { key } = request.params as { key: string }
    const { value } = request.body as { value: number }
    const data = await updateScoringParam(key, value)
    return reply.code(200).send(data)
  })
}
