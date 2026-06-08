import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import cron from 'node-cron'
import 'dotenv/config'
import prismaPlugin from './plugins/prisma.js'
import authenticatePlugin from './plugins/authenticate.js'
import healthRoutes from './routes/health.js'
import authRoutes from './routes/auth.js'
import groupRoutes from './routes/groups.js'
import koRoutes from './routes/ko.js'
import powerupsRoutes from './routes/powerups.js'
import adminRoutes from './routes/admin.js'
import scoreboardRoutes from './routes/scoreboard.js'
import whatsappRoutes from './routes/whatsapp.js'
import { syncStandings } from './crons/sync-standings.js'
import { syncKoResults } from './crons/sync-ko-results.js'
import { recalculateScores } from './crons/recalculate-scores.js'
import { sendWhatsappReminders } from './crons/whatsapp-reminder.js'
import { AppError } from './lib/errors.js'

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: true })

  server.register(cors, {
    credentials: true,
    origin: process.env.CORS_ORIGIN ?? true,
  })
  server.register(cookie)
  server.register(prismaPlugin)
  server.register(authenticatePlugin)
  server.register(healthRoutes, { prefix: '/health' })
  server.register(authRoutes, { prefix: '/auth' })
  server.register(groupRoutes, { prefix: '/groups' })
  server.register(koRoutes, { prefix: '/ko' })
  server.register(powerupsRoutes, { prefix: '/powerups' })
  server.register(adminRoutes, { prefix: '/admin' })
  server.register(scoreboardRoutes, { prefix: '/scoreboard' })
  server.register(whatsappRoutes, { prefix: '/admin/whatsapp' })

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message })
    }
    server.log.error(error)
    return reply
      .code((error as { statusCode?: number }).statusCode ?? 500)
      .send({ code: 'INTERNAL_ERROR', message: error.message })
  })

  if (process.env.NODE_ENV !== 'test') {
    syncStandings()
    syncKoResults()

    // sync-standings: 6AM, 12PM, 6PM Colombia (UTC-5) = 11, 17, 23 UTC
    cron.schedule('0 11,17,23 * * *', syncStandings)

    // sync-ko-results: cada 30 min entre 12PM y 1AM Colombia = 17-23 y 0-6 UTC
    cron.schedule('*/30 17-23,0-6 * * *', syncKoResults)

    // recalculate-scores: 1AM UTC diaria
    cron.schedule('0 1 * * *', recalculateScores)

    sendWhatsappReminders()
    cron.schedule('*/10 * * * *', sendWhatsappReminders)

    server.log.info('Crons registrados: sync-standings + sync-ko-results + recalculate-scores + whatsapp-reminder')
  }

  return server
}

if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? '3000')
  buildServer().then((server) => {
    server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
      if (err) {
        server.log.error(err)
        process.exit(1)
      }
    })
  })
}
