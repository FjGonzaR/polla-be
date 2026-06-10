import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'

async function buildThirdPlaceTeam(groupLabel: string) {
  const group = await prisma.group.create({
    data: { name: `Group ${groupLabel}`, label: groupLabel },
  })
  const team = await prisma.team.create({
    data: {
      name: `Team ${groupLabel}3`,
      code: `${groupLabel}T3`,
      groupId: group.id,
    },
  })
  await prisma.groupStanding.create({
    data: {
      teamId: team.id,
      groupId: group.id,
      realPosition: 3,
      matchesPlayed: 3,
      pts: 4,
    },
  })
  return team
}

async function buildTwelveThirdPlaceTeams() {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
  return Promise.all(labels.map(buildThirdPlaceTeam))
}

describe('PUT /admin/groups/thirds', () => {
  it('sets 8 qualified thirds → qualifiedAsThird updated, score events created', async () => {
    await seedScoringParams()
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTwelveThirdPlaceTeams()
    const qualifiedIds = teams.slice(0, 8).map((t) => t.id)

    const participant = await buildParticipant()
    await prisma.thirdPrediction.create({
      data: { participantId: participant.id, teamId: qualifiedIds[0] },
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds: qualifiedIds },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)

    const qualifiedCount = await prisma.groupStanding.count({ where: { qualifiedAsThird: true } })
    expect(qualifiedCount).toBe(8)

    const notQualifiedCount = await prisma.groupStanding.count({
      where: { realPosition: 3, qualifiedAsThird: false },
    })
    expect(notQualifiedCount).toBe(4)

    const event = await prisma.scoreEvent.findFirst({
      where: { participantId: participant.id, paramKey: 'pts_third_correct' },
    })
    expect(event).not.toBeNull()
    expect(event!.points).toBe(2)
  })

  it('re-setting with a different set replaces the previous qualification', async () => {
    await seedScoringParams()
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTwelveThirdPlaceTeams()

    const firstSet = teams.slice(0, 8).map((t) => t.id)
    const secondSet = teams.slice(4, 12).map((t) => t.id)

    const server = await buildServer()
    await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds: firstSet },
    })

    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds: secondSet },
    })

    expect(res.statusCode).toBe(200)

    for (const team of teams.slice(0, 4)) {
      const standing = await prisma.groupStanding.findUnique({ where: { teamId: team.id } })
      expect(standing!.qualifiedAsThird).toBe(false)
    }
    for (const team of teams.slice(4, 12)) {
      const standing = await prisma.groupStanding.findUnique({ where: { teamId: team.id } })
      expect(standing!.qualifiedAsThird).toBe(true)
    }
  })

  it('fewer than 8 IDs → 400 INVALID_THIRDS_COUNT', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTwelveThirdPlaceTeams()
    const server = await buildServer()

    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds: teams.slice(0, 5).map((t) => t.id) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_THIRDS_COUNT')
  })

  it('team not in position 3 → 400 INVALID_THIRD_TEAM', async () => {
    const { cookie } = await createAuthenticatedAdmin()
    const teams = await buildTwelveThirdPlaceTeams()

    const group = await prisma.group.create({ data: { name: 'Group M', label: 'M' } })
    const nonThirdTeam = await prisma.team.create({
      data: { name: 'First place team', code: 'FPT', groupId: group.id },
    })
    await prisma.groupStanding.create({
      data: { teamId: nonThirdTeam.id, groupId: group.id, realPosition: 1, matchesPlayed: 3, pts: 7 },
    })

    const teamIds = [...teams.slice(0, 7).map((t) => t.id), nonThirdTeam.id]
    const server = await buildServer()

    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_THIRD_TEAM')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      payload: { teamIds: [] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('participant role → 403', async () => {
    const { cookie } = await createAuthenticatedParticipant()
    const server = await buildServer()
    const res = await server.inject({
      method: 'PUT',
      url: '/admin/groups/thirds',
      headers: { cookie },
      payload: { teamIds: [] },
    })
    expect(res.statusCode).toBe(403)
  })
})
