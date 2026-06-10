import { describe, it, expect, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { signSession } from '../../lib/session.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildScoringParam } from '../builders/scoring-param.builder.js'

type Team = { id: string }

async function predictGroup(
  participantId: string,
  groupId: string,
  rankings: Array<{ teamId: string; position: number }>,
) {
  await prisma.groupPrediction.createMany({
    data: rankings.map((r) => ({
      participantId,
      groupId,
      teamId: r.teamId,
      predictedPosition: r.position,
    })),
  })
}

async function createStandings(groupId: string, teams: Array<{ id: string; realPosition: number }>) {
  await Promise.all(
    teams.map((t) =>
      prisma.groupStanding.create({
        data: { teamId: t.id, groupId, pts: 0, goalsFor: 0, goalsAgainst: 0, realPosition: t.realPosition, matchesPlayed: 1 },
      }),
    ),
  )
}

describe('GET /groups/predictions/me', () => {
  let groupAId: string
  let mex: Team, usa: Team, col: Team, ecu: Team

  beforeEach(async () => {
    const groupA = await new GroupBuilder().withLabel('A').withName('Grupo A').build()
    groupAId = groupA.id
    ;[mex, usa, col, ecu] = await Promise.all([
      new TeamBuilder().withName('México').withCode('MEX').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('USA').withCode('USA').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('Colombia').withCode('COL').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('Ecuador').withCode('ECU').withGroupId(groupA.id).build(),
    ])
    await Promise.all([
      buildScoringParam({ key: 'pts_group_position_exact', value: 3 }),
      buildScoringParam({ key: 'bonus_group_complete', value: 10 }),
    ])
  })

  it('retorna grupos con groupComplete false y rankings vacíos cuando no hay predicciones', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    expect(res.statusCode).toBe(200)
    const { data, completedGroups } = res.json()
    expect(data.length).toBe(1)
    expect(completedGroups).toBe(0)
    expect(data[0].groupComplete).toBe(false)
    expect(data[0].rankings.length).toBe(0)
    expect(data[0].pointsEarned).toBeNull()
  })

  it('groupComplete true cuando hay 4 posiciones predichas', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    const { data } = res.json()
    expect(data[0].groupComplete).toBe(true)
    expect(data[0].rankings.length).toBe(4)
    expect(data[0].pointsEarned).toBeNull() // sin standings
    expect(data[0].rankings[0].flag).toBe('https://flagcdn.com/w80/xx.png')
  })

  it('pointsEarned null si no hay standings aunque haya predicciones completas', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    expect(res.json().data[0].pointsEarned).toBeNull()
  })

  it('4/4 exactos → pts correcto con bonus', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])
    await createStandings(groupAId, [
      { id: mex.id, realPosition: 1 },
      { id: usa.id, realPosition: 2 },
      { id: col.id, realPosition: 3 },
      { id: ecu.id, realPosition: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    const { pointsEarned } = res.json().data[0]
    expect(pointsEarned.pts_group_position_exact).toBe(12) // 4 × 3
    expect(pointsEarned.bonus_group_complete).toBe(10)
    expect(pointsEarned.total).toBe(22)
  })

  it('2/4 exactos → puntos parciales sin bonus', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])
    await createStandings(groupAId, [
      { id: mex.id, realPosition: 1 },
      { id: usa.id, realPosition: 2 },
      { id: ecu.id, realPosition: 3 },
      { id: col.id, realPosition: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    const { pointsEarned } = res.json().data[0]
    expect(pointsEarned.pts_group_position_exact).toBe(6) // 2 × 3
    expect(pointsEarned.bonus_group_complete).toBe(0)
    expect(pointsEarned.total).toBe(6)
  })

  it('0/4 exactos → todo en cero', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])
    await createStandings(groupAId, [
      { id: ecu.id, realPosition: 1 },
      { id: col.id, realPosition: 2 },
      { id: usa.id, realPosition: 3 },
      { id: mex.id, realPosition: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    const { pointsEarned } = res.json().data[0]
    expect(pointsEarned.pts_group_position_exact).toBe(0)
    expect(pointsEarned.bonus_group_complete).toBe(0)
    expect(pointsEarned.total).toBe(0)
  })

  it('respeta valores de scoring_params sin hardcodear', async () => {
    await prisma.scoringParam.update({ where: { key: 'pts_group_position_exact' }, data: { value: 5 } })

    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })
    await predictGroup(participant.id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])
    await createStandings(groupAId, [
      { id: mex.id, realPosition: 1 },
      { id: usa.id, realPosition: 2 },
      { id: col.id, realPosition: 3 },
      { id: ecu.id, realPosition: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me', cookies: { session: token } })

    expect(res.json().data[0].pointsEarned.total).toBe(30) // 5×4 + 10
  })

  it('401 sin cookie', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/me' })
    expect(res.statusCode).toBe(401)
  })
})
