import type { FastifyInstance } from 'fastify'
import { signSession } from '../lib/session.js'
import { loginOrSignup } from '../services/auth.service.js'

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/google', async (request, reply) => {
    const { credential, code, phone } = request.body as {
      credential?: string
      code?: string
      phone?: string
    }

    if (!credential) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'credential es requerido' })
    }

    const participant = await loginOrSignup(credential, code, phone)

    reply.setCookie('session', signSession({ userId: participant.id }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'none' | 'strict') ?? 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })

    return reply.code(200).send({
      id: participant.id,
      name: participant.name,
      email: participant.email,
      role: participant.role,
    })
  })

  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie('session', { path: '/' })
    return reply.code(200).send({ ok: true })
  })
}
