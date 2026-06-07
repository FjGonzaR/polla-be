import type { FastifyInstance } from 'fastify'
import { getScoreboard } from '../services/scoreboard.service.js'

export default async function scoreboardRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    const data = await getScoreboard()
    return reply.code(200).send(data)
  })
}
