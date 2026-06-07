import type { FastifyInstance } from 'fastify'
import { getScoreboard, getScoreboardBreakdown } from '../services/scoreboard.service.js'

export default async function scoreboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.get('/', async (_request, reply) => {
    const data = await getScoreboard()
    return reply.code(200).send(data)
  })

  fastify.get('/:participantId/breakdown', async (request, reply) => {
    const { participantId } = request.params as { participantId: string }
    const data = await getScoreboardBreakdown(participantId)
    return reply.code(200).send(data)
  })
}
