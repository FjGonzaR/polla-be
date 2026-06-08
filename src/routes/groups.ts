import type { FastifyInstance } from 'fastify'
import { findAllGroups, upsertGroupPredictions, findMyGroupPredictions, findFriendsGroupPredictions } from '../services/groups.service.js'
import { findMyThirds, saveThirds } from '../services/thirds.service.js'
import { isGroupPhaseLocked } from '../lib/lock.js'

export default async function groupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.get('/', async (_request, reply) => {
    const groups = await findAllGroups()
    return reply.send({ data: groups })
  })

  fastify.get('/predictions/me', async (request, reply) => {
    const result = await findMyGroupPredictions(request.user.id)
    return reply.send(result)
  })

  fastify.get('/predictions/friends', async (request, reply) => {
    const { participantId } = request.query as { participantId?: string }
    const result = await findFriendsGroupPredictions(request.user.id, participantId)
    return reply.send(result)
  })

  fastify.get('/thirds', async (request, reply) => {
    const result = await findMyThirds(request.user.id)
    return reply.send(result)
  })

  fastify.post('/thirds', async (request, reply) => {
    const locked = await isGroupPhaseLocked()
    if (locked) {
      return reply.code(423).send({ code: 'PREDICTIONS_LOCKED', error: 'Predictions are locked' })
    }
    const { teamIds } = request.body as { teamIds: string[] }
    const result = await saveThirds(request.user.id, teamIds)
    return reply.send(result)
  })

  fastify.post('/predictions', async (request, reply) => {
    const locked = await isGroupPhaseLocked()
    if (locked) {
      return reply.code(423).send({ code: 'PREDICTIONS_LOCKED', error: 'Las predicciones de grupos están cerradas' })
    }

    const { predictions } = request.body as {
      predictions: Array<{
        groupId: string
        rankings: Array<{ teamId: string; position: number }>
      }>
    }
    const result = await upsertGroupPredictions(request.user.id, predictions)
    return reply.send({ ok: true, ...result })
  })
}
