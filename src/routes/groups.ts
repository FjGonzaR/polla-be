import type { FastifyInstance } from 'fastify'
import { findAllGroups } from '../services/groups.service.js'

export default async function groupRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.get('/', async (_request, reply) => {
    const groups = await findAllGroups()
    return reply.send({ data: groups })
  })
}
