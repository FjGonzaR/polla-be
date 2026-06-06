import Fastify from 'fastify'
import cors from '@fastify/cors'
import 'dotenv/config'
import prismaPlugin from './plugins/prisma'
import healthRoutes from './routes/health'

const server = Fastify({ logger: true })

server.register(cors)
server.register(prismaPlugin)
server.register(healthRoutes, { prefix: '/health' })

const PORT = parseInt(process.env.PORT ?? '3000')

server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
})
