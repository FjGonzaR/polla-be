import type { FastifyInstance } from 'fastify'
import { AppError } from '../lib/errors.js'
import { findKoMatches, findKoMatch } from '../services/ko.service.js'

export default async function koRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.get('/matches', async (request, reply) => {
    const { roundSlug } = request.query as { roundSlug?: string }
    if (!roundSlug) throw new AppError(400, 'VALIDATION_ERROR', 'roundSlug is required')
    const result = await findKoMatches(roundSlug, request.user.id)
    return reply.send(result)
  })

  fastify.get('/matches/:matchId', async (request, reply) => {
    const { matchId } = request.params as { matchId: string }
    const result = await findKoMatch(matchId, request.user.id)
    return reply.send(result)
  })
}
