import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { signSession } from '../../lib/session.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'

async function setupGroup(label: string) {
  const group = await new GroupBuilder().withLabel(label).withName(`Grupo ${label}`).build()
  const [t1, t2, t3, t4] = await Promise.all([
    new TeamBuilder().withName(`Team ${label}1`).withCode(`${label}T1`).withGroupId(group.id).build(),
    new TeamBuilder().withName(`Team ${label}2`).withCode(`${label}T2`).withGroupId(group.id).build(),
    new TeamBuilder().withName(`Team ${label}3`).withCode(`${label}T3`).withGroupId(group.id).build(),
    new TeamBuilder().withName(`Team ${label}4`).withCode(`${label}T4`).withGroupId(group.id).build(),
  ])
  return { group, teams: [t1, t2, t3, t4] }
}

function makeRankings(teams: { id: string }[]) {
  return teams.map((t, i) => ({ teamId: t.id, position: i + 1 }))
}

describe('POST /groups/predictions', () => {
  it('guarda predicciones de un grupo correctamente → 200', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group, teams } = await setupGroup('A')

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: { predictions: [{ groupId: group.id, rankings: makeRankings(teams) }] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, savedGroups: 1 })
    const count = await prisma.groupPrediction.count({ where: { groupId: group.id } })
    expect(count).toBe(4)
  })

  it('guarda predicciones de múltiples grupos en un request', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group: groupA, teams: teamsA } = await setupGroup('A')
    const { group: groupB, teams: teamsB } = await setupGroup('B')

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: {
        predictions: [
          { groupId: groupA.id, rankings: makeRankings(teamsA) },
          { groupId: groupB.id, rankings: makeRankings(teamsB) },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().savedGroups).toBe(2)
    expect(await prisma.groupPrediction.count({ where: { groupId: groupA.id } })).toBe(4)
    expect(await prisma.groupPrediction.count({ where: { groupId: groupB.id } })).toBe(4)
  })

  it('hace upsert si ya existían predicciones para ese grupo', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group, teams } = await setupGroup('A')

    const server = await buildServer()

    await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: { predictions: [{ groupId: group.id, rankings: makeRankings(teams) }] },
    })

    const reversed = [...teams].reverse()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: { predictions: [{ groupId: group.id, rankings: makeRankings(reversed) }] },
    })

    expect(res.statusCode).toBe(200)
    const count = await prisma.groupPrediction.count({ where: { groupId: group.id } })
    expect(count).toBe(4)

    const pred = await prisma.groupPrediction.findFirst({
      where: { groupId: group.id, teamId: reversed[0].id },
    })
    expect(pred?.predictedPosition).toBe(1)
  })

  it('423 cuando el grupo específico está cerrado', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group, teams } = await setupGroup('A')

    await prisma.group.update({ where: { id: group.id }, data: { lockedAt: new Date(Date.now() - 1000) } })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: { predictions: [{ groupId: group.id, rankings: makeRankings(teams) }] },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('GROUP_LOCKED')
  })

  it('423 cuando el candado está activo', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    await prisma.round.upsert({
      where: { slug: 'GROUP' },
      create: { name: 'Group Stage', slug: 'GROUP', order: 1, matchCount: 48, lockedAt: new Date(Date.now() - 1000) },
      update: { lockedAt: new Date(Date.now() - 1000) },
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: { predictions: [] },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('PREDICTIONS_LOCKED')
  })

  it('400 posiciones duplicadas', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group, teams } = await setupGroup('A')

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: {
        predictions: [{
          groupId: group.id,
          rankings: [
            { teamId: teams[0].id, position: 1 },
            { teamId: teams[1].id, position: 1 },
            { teamId: teams[2].id, position: 3 },
            { teamId: teams[3].id, position: 4 },
          ],
        }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_RANKINGS')
  })

  it('400 teamId que no pertenece al grupo', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    const { group, teams } = await setupGroup('A')
    const outsider = await new TeamBuilder().withName('Outsider').withCode('OUT').build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: {
        predictions: [{
          groupId: group.id,
          rankings: [
            { teamId: teams[0].id, position: 1 },
            { teamId: teams[1].id, position: 2 },
            { teamId: teams[2].id, position: 3 },
            { teamId: outsider.id, position: 4 },
          ],
        }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_RANKINGS')
  })

  it('400 groupId inexistente', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      cookies: { session: token },
      payload: {
        predictions: [{
          groupId: '00000000-0000-0000-0000-000000000000',
          rankings: [],
        }],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('GROUP_NOT_FOUND')
  })

  it('401 sin cookie', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      payload: { predictions: [] },
    })

    expect(res.statusCode).toBe(401)
  })
})
