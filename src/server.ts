import Fastify from 'fastify'
import cors from '@fastify/cors'
import 'dotenv/config'

const server = Fastify({ logger: true })

server.register(cors)

const PORT = parseInt(process.env.PORT ?? '3000')

server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
})
