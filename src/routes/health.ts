import { FastifyInstance } from 'fastify'

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`
      return reply.code(200).send({
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      return reply.code(503).send({
        status: 'error',
        db: 'disconnected',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
