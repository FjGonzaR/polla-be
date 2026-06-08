import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { Participant } from '@prisma/client'
import { ParticipantRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { verifySession } from '../lib/session.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: Participant
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const authenticatePlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.session
    if (!token) {
      return reply.code(401).send({ code: 'MISSING_SESSION', message: 'Session required' })
    }
    try {
      const { userId } = verifySession(token)
      const participant = await prisma.participant.findUniqueOrThrow({
        where: { id: userId },
      })
      request.user = participant
    } catch {
      return reply.code(401).send({ code: 'INVALID_SESSION', message: 'Invalid or expired session' })
    }
  })

  fastify.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user || request.user.role !== ParticipantRole.ADMIN) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' })
    }
  })
}

export default fp(authenticatePlugin)
