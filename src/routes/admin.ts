import type { FastifyInstance } from 'fastify'
import { InvitationStatus } from '@prisma/client'
import { createInvitation, listInvitations } from '../services/invitation.service.js'

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/invitations',
    { preHandler: [fastify.authenticate, fastify.requireAdmin] },
    async (_request, reply) => {
      const inv = await createInvitation()
      return reply.code(201).send(inv)
    },
  )

  fastify.get(
    '/invitations',
    { preHandler: [fastify.authenticate, fastify.requireAdmin] },
    async (request, reply) => {
      const { status, page, pageSize } = request.query as {
        status?: string
        page?: string
        pageSize?: string
      }
      const statusFilter =
        status && Object.values(InvitationStatus).includes(status as InvitationStatus)
          ? (status as InvitationStatus)
          : undefined
      const result = await listInvitations(
        statusFilter,
        page ? parseInt(page, 10) : undefined,
        pageSize ? parseInt(pageSize, 10) : undefined,
      )
      return reply.code(200).send(result)
    },
  )
}
