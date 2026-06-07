import { describe, it, expect, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'

describe('POST /groups/thirds', () => {
  let participantId: string
  let cookie: string
  let candidateIds: string[]

  beforeEach(async () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const groups = await Promise.all(
      labels.map((l) => new GroupBuilder().withLabel(l).withName(`Group ${l}`).build()),
    )

    const thirdTeams = await Promise.all(
      groups.map((g) =>
        new TeamBuilder().withName(`T3-${g.label}`).withCode(`T${g.label}3`).withGroupId(g.id).build(),
      ),
    )
    candidateIds = thirdTeams.map((t) => t.id)

    const auth = await createAuthenticatedParticipant()
    participantId = auth.participant.id
    cookie = auth.cookie

    await prisma.groupPrediction.createMany({
      data: groups.map((g, i) => ({
        participantId,
        groupId: g.id,
        teamId: candidateIds[i],
        predictedPosition: 3,
      })),
    })
  })

  it('saves 8 valid candidates and returns ok + selectedCount 8', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: candidateIds },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, selectedCount: 8 })

    const rows = await prisma.thirdPrediction.findMany({ where: { participantId } })
    expect(rows).toHaveLength(8)
  })

  it('replaces previous selection on second POST', async () => {
    const server = await buildServer()
    await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: candidateIds },
    })

    const reversed = [...candidateIds].reverse()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: reversed },
    })

    expect(res.statusCode).toBe(200)
    const rows = await prisma.thirdPrediction.findMany({ where: { participantId } })
    expect(rows).toHaveLength(8)
  })

  it('400 INVALID_THIRDS_COUNT when fewer than 8 teamIds', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: candidateIds.slice(0, 5) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_THIRDS_COUNT')
  })

  it('400 INVALID_THIRDS_COUNT when more than 8 teamIds', async () => {
    const extraGroup = await new GroupBuilder().withLabel('Z').withName('Group Z').build()
    const extraTeam = await new TeamBuilder().withName('Extra').withCode('EXT').withGroupId(extraGroup.id).build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: [...candidateIds, extraTeam.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_THIRDS_COUNT')
  })

  it('400 INVALID_THIRD_CANDIDATE when teamId not in candidate list', async () => {
    const otherGroup = await new GroupBuilder().withLabel('X').withName('Group X').build()
    const notACandidate = await new TeamBuilder()
      .withName('NotThird')
      .withCode('NTH')
      .withGroupId(otherGroup.id)
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: [...candidateIds.slice(0, 7), notACandidate.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_THIRD_CANDIDATE')
  })

  it('423 when group phase is locked', async () => {
    await new MatchBuilder().withLockedAt(new Date(Date.now() - 86_400_000)).build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: candidateIds },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('PREDICTIONS_LOCKED')
  })

  it('401 without cookie', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      payload: { teamIds: candidateIds },
    })
    expect(res.statusCode).toBe(401)
  })
})
