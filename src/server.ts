import Fastify from 'fastify'
import cors from '@fastify/cors'
import cron from 'node-cron'
import 'dotenv/config'
import prismaPlugin from './plugins/prisma.js'
import healthRoutes from './routes/health.js'
import { syncStandings } from './crons/sync-standings.js'
import { syncKoResults } from './crons/sync-ko-results.js'

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

if (process.env.NODE_ENV !== 'test') {
  syncStandings()
  syncKoResults()

  // sync-standings: 6AM, 12PM, 6PM Colombia (UTC-5) = 11, 17, 23 UTC
  cron.schedule('0 11,17,23 * * *', syncStandings)

  // sync-ko-results: cada 30 min entre 12PM y 1AM Colombia = 17-23 y 0-6 UTC
  cron.schedule('*/30 17-23,0-6 * * *', syncKoResults)

  server.log.info('Crons registrados: sync-standings (11,17,23 UTC) + sync-ko-results (cada 30min)')
}
