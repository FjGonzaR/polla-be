import { describe, it, expect, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'

describe('GET /groups/thirds', () => {
  let groupId: string
  let team1Id: string
  let team2Id: string
  let team3Id: string
  let team4Id: string

  beforeEach(async () => {
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()
    groupId = group.id
    const [t1, t2, t3, t4] = await Promise.all([
      new TeamBuilder().withName('Team1').withCode('T1').withGroupId(groupId).build(),
      new TeamBuilder().withName('Team2').withCode('T2').withGroupId(groupId).build(),
      new TeamBuilder().withName('Team3').withCode('T3').withGroupId(groupId).build(),
      new TeamBuilder().withName('Team4').withCode('T4').withGroupId(groupId).build(),
    ])
    team1Id = t1.id
    team2Id = t2.id
    team3Id = t3.id
    team4Id = t4.id
  })

  it('returns only the team predicted at position 3', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    await prisma.groupPrediction.createMany({
      data: [
        { participantId: participant.id, groupId, teamId: team1Id, predictedPosition: 1 },
        { participantId: participant.id, groupId, teamId: team2Id, predictedPosition: 2 },
        { participantId: participant.id, groupId, teamId: team3Id, predictedPosition: 3 },
        { participantId: participant.id, groupId, teamId: team4Id, predictedPosition: 4 },
      ],
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].teamId).toBe(team3Id)
    expect(body.data[0].label).toBe('A')
    expect(body.data[0].groupId).toBe(groupId)
    expect(body.data[0].flag).toBe('https://flagcdn.com/w80/xx.png')
  })

  it('selected: false when team not yet saved as third prediction', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    await prisma.groupPrediction.create({
      data: { participantId: participant.id, groupId, teamId: team3Id, predictedPosition: 3 },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.json().data[0].selected).toBe(false)
  })

  it('selected: true when team is saved as third prediction', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    await prisma.groupPrediction.create({
      data: { participantId: participant.id, groupId, teamId: team3Id, predictedPosition: 3 },
    })
    await prisma.thirdPrediction.create({ data: { participantId: participant.id, teamId: team3Id } })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.json().data[0].selected).toBe(true)
  })

  it('selectedCount matches number of saved third predictions', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    await prisma.groupPrediction.create({
      data: { participantId: participant.id, groupId, teamId: team3Id, predictedPosition: 3 },
    })
    await prisma.thirdPrediction.create({ data: { participantId: participant.id, teamId: team3Id } })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.json().selectedCount).toBe(1)
  })

  it('returns empty data when participant has no group predictions', async () => {
    const { cookie } = await createAuthenticatedParticipant()

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(0)
    expect(res.json().selectedCount).toBe(0)
  })

  it('pointsEarned is always null', async () => {
    const { participant, cookie } = await createAuthenticatedParticipant()
    await prisma.groupPrediction.create({
      data: { participantId: participant.id, groupId, teamId: team3Id, predictedPosition: 3 },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds', headers: { cookie } })

    expect(res.json().data[0].pointsEarned).toBeNull()
  })

  it('401 without cookie', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/thirds' })
    expect(res.statusCode).toBe(401)
  })
})
