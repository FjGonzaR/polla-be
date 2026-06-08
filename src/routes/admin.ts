import type { FastifyInstance } from 'fastify'
import { InvitationStatus, type RoundSlug } from '@prisma/client'
import { createInvitation, listInvitations } from '../services/invitation.service.js'
import {
  setMatchResult,
  updateScoringParam,
  setQualifiedThirds,
  loadGroups,
  loadKoMatches,
  setTop8Teams,
  listParticipants,
} from '../services/admin.service.js'

export default async function adminRoutes(fastify: FastifyInstance) {

  fastify.post('/invitations', async (_request, reply) => {
    const inv = await createInvitation()
    return reply.code(201).send(inv)
  })

  fastify.get('/invitations', async (request, reply) => {
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
  })

  fastify.put('/ko/matches/:matchId/result', async (request, reply) => {
    const { matchId } = request.params as { matchId: string }
    const body = request.body as { scoreHome: number; scoreAway: number; winnerTeamId: string }
    const result = await setMatchResult(matchId, body)
    return reply.code(200).send(result)
  })

  fastify.put('/groups/thirds', async (request, reply) => {
    const { teamIds } = request.body as { teamIds: string[] }
    await setQualifiedThirds(teamIds)
    return reply.code(200).send({ ok: true })
  })

  fastify.put('/scoring-params/:key', async (request, reply) => {
    const { key } = request.params as { key: string }
    const { value } = request.body as { value: number }
    const data = await updateScoringParam(key, value)
    return reply.code(200).send(data)
  })

  fastify.post('/groups', async (request, reply) => {
    const { groups } = request.body as {
      groups: {
        label: string
        name: string
        lastMatchAt?: string | null
        teams: { name: string; code: string; isTop8: boolean }[]
      }[]
    }
    const result = await loadGroups(groups)
    return reply.code(201).send({ ok: true, ...result })
  })

  fastify.post('/ko/matches', async (request, reply) => {
    const { roundSlug, matches } = request.body as {
      roundSlug: RoundSlug
      matches: {
        externalMatchId: string | number
        matchNumber: number
        homeTeamId?: string | null
        awayTeamId?: string | null
        homeTeamLabel?: string | null
        awayTeamLabel?: string | null
        scheduledAt: string
      }[]
    }
    const result = await loadKoMatches(roundSlug, matches)
    return reply.code(201).send({ ok: true, ...result })
  })

  fastify.put('/top8', async (request, reply) => {
    const { teamIds } = request.body as { teamIds: string[] }
    const result = await setTop8Teams(teamIds)
    return reply.code(200).send(result)
  })

  fastify.get('/participants', async (_request, reply) => {
    const data = await listParticipants()
    return reply.code(200).send({ data })
  })
}
