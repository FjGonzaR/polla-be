import { describe, it, expect, beforeEach } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { buildScoringParam } from '../builders/scoring-param.builder.js'

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
        data: { teamId: t.id, groupId, pts: 0, goalsFor: 0, goalsAgainst: 0, realPosition: t.realPosition },
      }),
    ),
  )
}

describe('GET /groups/predictions/friends', () => {
  let groupAId: string
  let mex: { id: string }, usa: { id: string }, col: { id: string }, ecu: { id: string }
  let friend1Id: string
  let friend2Id: string

  beforeEach(async () => {
    const groupA = await new GroupBuilder().withLabel('A').withName('Group A').build()
    groupAId = groupA.id
    ;[mex, usa, col, ecu] = await Promise.all([
      new TeamBuilder().withName('Mexico').withCode('MEX').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('USA').withCode('USA').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('Colombia').withCode('COL').withGroupId(groupA.id).build(),
      new TeamBuilder().withName('Ecuador').withCode('ECU').withGroupId(groupA.id).build(),
    ])
    await Promise.all([
      buildScoringParam({ key: 'pts_group_position_exact', value: 3 }),
      buildScoringParam({ key: 'bonus_group_complete', value: 10 }),
    ])
    const f1 = await createAuthenticatedParticipant({ googleId: 'uid-friend1', email: 'friend1@test.com' })
    const f2 = await createAuthenticatedParticipant({ googleId: 'uid-friend2', email: 'friend2@test.com' })
    friend1Id = f1.participant.id
    friend2Id = f2.participant.id
  })

  it('available: false when no matches in DB', async () => {
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(false)
    expect(body.availableAt).toBeNull()
  })

  it('available: false when first match is in the future', async () => {
    await new MatchBuilder().build() // default scheduledAt is tomorrow
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().available).toBe(false)
    expect(res.json().availableAt).not.toBeNull()
  })

  it('available: true when first match is in the past', async () => {
    await new MatchBuilder().withScheduledAt(new Date(Date.now() - 86_400_000)).build()
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().available).toBe(true)
    expect(Array.isArray(res.json().data)).toBe(true)
  })

  it('does not include the authenticated participant in results', async () => {
    await new MatchBuilder().withScheduledAt(new Date(Date.now() - 86_400_000)).build()
    const { participant: me, cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    const ids = res.json().data.map((d: { participant: { id: string } }) => d.participant.id)
    expect(ids).not.toContain(me.id)
    expect(ids).toContain(friend1Id)
    expect(ids).toContain(friend2Id)
  })

  it('returns empty predictions and totalGroupPoints 0 for friend with no predictions', async () => {
    await new MatchBuilder().withScheduledAt(new Date(Date.now() - 86_400_000)).build()
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    const friend1Entry = res.json().data.find((d: { participant: { id: string } }) => d.participant.id === friend1Id)
    expect(friend1Entry).toBeDefined()
    expect(friend1Entry.totalGroupPoints).toBe(0)
    expect(friend1Entry.predictions.every((g: { groupComplete: boolean }) => !g.groupComplete)).toBe(true)
  })

  it('totalGroupPoints 22 for friend with 4/4 exact predictions and standings', async () => {
    await new MatchBuilder().withScheduledAt(new Date(Date.now() - 86_400_000)).build()
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    await predictGroup(friend1Id, groupAId, [
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
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    const friend1Entry = res.json().data.find((d: { participant: { id: string } }) => d.participant.id === friend1Id)
    expect(friend1Entry.totalGroupPoints).toBe(22) // 4×3 + 10 bonus
  })

  it('totalGroupPoints 0 when predictions exist but no standings', async () => {
    await new MatchBuilder().withScheduledAt(new Date(Date.now() - 86_400_000)).build()
    const { cookie } = await createAuthenticatedParticipant({ googleId: 'uid-me', email: 'me@test.com' })

    await predictGroup(friend1Id, groupAId, [
      { teamId: mex.id, position: 1 },
      { teamId: usa.id, position: 2 },
      { teamId: col.id, position: 3 },
      { teamId: ecu.id, position: 4 },
    ])

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends', headers: { cookie } })

    const friend1Entry = res.json().data.find((d: { participant: { id: string } }) => d.participant.id === friend1Id)
    expect(friend1Entry.totalGroupPoints).toBe(0)
    expect(friend1Entry.predictions[0].pointsEarned).toBeNull()
  })

  it('401 without cookie', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/predictions/friends' })
    expect(res.statusCode).toBe(401)
  })
})
