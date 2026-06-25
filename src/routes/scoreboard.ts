import type { FastifyInstance } from 'fastify'
import { getScoreboard, getScoreboardBreakdown } from '../services/scoreboard.service.js'
import { AppError } from '../lib/errors.js'

const SORT_BY_VALUES = ['total', 'real', 'simulated'] as const
type SortBy = (typeof SORT_BY_VALUES)[number]

export default async function scoreboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.get('/', async (request, reply) => {
    const { sortBy, limit } = request.query as { sortBy?: string; limit?: string }

    let resolvedSortBy: SortBy = 'total'
    if (sortBy !== undefined) {
      if (!SORT_BY_VALUES.includes(sortBy as SortBy)) {
        throw new AppError(400, 'INVALID_SORT_BY', `sortBy must be one of: ${SORT_BY_VALUES.join(', ')}`)
      }
      resolvedSortBy = sortBy as SortBy
    }

    let resolvedLimit: number | 'all' = 10
    if (limit !== undefined) {
      if (limit === 'all') {
        resolvedLimit = 'all'
      } else {
        const parsed = Number(limit)
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new AppError(400, 'INVALID_LIMIT', 'limit must be a positive integer or "all"')
        }
        resolvedLimit = parsed
      }
    }

    const data = await getScoreboard(request.user.id, resolvedSortBy, resolvedLimit)
    return reply.code(200).send(data)
  })

  fastify.get('/:participantId/breakdown', async (request, reply) => {
    const { participantId } = request.params as { participantId: string }
    const data = await getScoreboardBreakdown(participantId)
    return reply.code(200).send(data)
  })
}
