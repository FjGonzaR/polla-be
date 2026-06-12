import { describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildServer } from '../../server.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { signSession } from '../../lib/session.js'

async function authCookie(): Promise<string> {
  const participant = await buildParticipant()
  return `session=${signSession({ userId: participant.id })}`
}

describe('GET /groups/matches', () => {
  it('success → 200 with group matches ordered by scheduledAt', async () => {
    const cookie = await authCookie()

    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const home = await new TeamBuilder().withName('Colombia').withCode('COL').withGroupId(group.id).build()
    const away = await new TeamBuilder().withName('Brazil').withCode('BRA').withGroupId(group.id).build()

    const later = new Date('2026-06-15T18:00:00.000Z')
    const earlier = new Date('2026-06-14T18:00:00.000Z')

    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withScheduledAt(later)
      .build()
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withScheduledAt(earlier)
      .build()

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/matches', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(2)
    expect(new Date(data[0].scheduledAt).getTime()).toBeLessThan(new Date(data[1].scheduledAt).getTime())
    expect(data[0].groupLabel).toBe('A')
    expect(data[0].homeTeam.code).toBe('COL')
    expect(data[0].awayTeam.code).toBe('BRA')
    expect(data[0].status).toBe('SCHEDULED')
  })

  it('KO matches are excluded', async () => {
    const cookie = await authCookie()

    await new MatchBuilder().withRoundSlug('GROUP').build()
    await new MatchBuilder().withRoundSlug('R32').build()

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/matches', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('?groupId filter → only matches of that group', async () => {
    const cookie = await authCookie()

    const groupA = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const groupB = await prisma.group.create({ data: { name: 'Group B', label: 'B' } })
    const teamA = await new TeamBuilder().withGroupId(groupA.id).build()
    const teamB = await new TeamBuilder().withGroupId(groupB.id).build()

    await new MatchBuilder().withRoundSlug('GROUP').withHomeTeamId(teamA.id).build()
    await new MatchBuilder().withRoundSlug('GROUP').withHomeTeamId(teamB.id).build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: `/groups/matches?groupId=${groupA.id}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(1)
    expect(data[0].groupId).toBe(groupA.id)
    expect(data[0].groupLabel).toBe('A')
  })

  it('?date filter → only matches on that Colombia-day (incl. UTC-5 boundary)', async () => {
    const cookie = await authCookie()

    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const home = await new TeamBuilder().withGroupId(group.id).build()

    // 2026-06-15T03:00Z is 2026-06-14 22:00 in Colombia → belongs to Jun 14.
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withScheduledAt(new Date('2026-06-15T03:00:00.000Z'))
      .build()
    // 2026-06-15T18:00Z is 2026-06-15 13:00 in Colombia → belongs to Jun 15.
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withScheduledAt(new Date('2026-06-15T18:00:00.000Z'))
      .build()

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups/matches?date=2026-06-14',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(1)
    expect(new Date(data[0].scheduledAt).toISOString()).toBe('2026-06-15T03:00:00.000Z')
  })

  it('?date=garbage → 400 INVALID_DATE', async () => {
    const cookie = await authCookie()

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups/matches?date=garbage',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_DATE')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups/matches' })
    expect(res.statusCode).toBe(401)
  })
})
