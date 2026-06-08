import type { FastifyInstance } from 'fastify'
import qrcode from 'qrcode'
import { getLastQr, getWhatsappStatus } from '../lib/whatsapp.client.js'

export default async function whatsappRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/qr',
    { preHandler: [fastify.authenticate, fastify.requireAdmin] },
    async (_request, reply) => {
      const { connected, qrPending } = getWhatsappStatus()

      if (connected) {
        return reply.code(200).send({ status: 'connected' })
      }

      if (!qrPending) {
        return reply.code(503).send({ status: 'initializing', message: 'No QR available yet — retry in a few seconds' })
      }

      const png = await qrcode.toBuffer(getLastQr()!, { type: 'png', width: 400 })
      return reply.type('image/png').code(200).send(png)
    },
  )
}
