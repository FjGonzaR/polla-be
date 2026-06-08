import type { FastifyInstance } from 'fastify'
import {
  createPowerups,
  updatePowerups,
  findMyPowerups,
  findFriendsPowerups,
} from '../services/powerups.service.js'

export default async function powerupsRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/predictions',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { darkHorseTeamId, disappointmentTeamId } = request.body as {
        darkHorseTeamId?: string
        disappointmentTeamId?: string
      }
      if (!darkHorseTeamId || !disappointmentTeamId) {
        return reply
          .code(400)
          .send({ code: 'MISSING_FIELDS', message: 'darkHorseTeamId and disappointmentTeamId are required' })
      }
      const result = await createPowerups(request.user.id, darkHorseTeamId, disappointmentTeamId)
      return reply.code(201).send(result)
    },
  )

  fastify.put(
    '/predictions',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { darkHorseTeamId, disappointmentTeamId } = request.body as {
        darkHorseTeamId?: string
        disappointmentTeamId?: string
      }
      const result = await updatePowerups(request.user.id, darkHorseTeamId, disappointmentTeamId)
      return reply.code(200).send(result)
    },
  )

  fastify.get(
    '/predictions/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const result = await findMyPowerups(request.user.id)
      return reply.code(200).send(result)
    },
  )

  fastify.get(
    '/predictions/friends',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const result = await findFriendsPowerups(request.user.id)
      return reply.code(200).send(result)
    },
  )
}
