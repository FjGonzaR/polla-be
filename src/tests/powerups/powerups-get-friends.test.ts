import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

async function buildPastMatch() {
  const homeTeam = await new TeamBuilder().build()
  const awayTeam = await new TeamBuilder().build()
  return new MatchBuilder()
    .withRoundSlug('GROUP')
    .withHomeTeamId(homeTeam.id)
    .withAwayTeamId(awayTeam.id)
    .withScheduledAt(new Date(Date.now() - 86_400_000))
    .build()
}

async function buildFutureMatch() {
  const homeTeam = await new TeamBuilder().build()
  const awayTeam = await new TeamBuilder().build()
  return new MatchBuilder()
    .withRoundSlug('GROUP')
    .withHomeTeamId(homeTeam.id)
    .withAwayTeamId(awayTeam.id)
    .withScheduledAt(new Date(Date.now() + 86_400_000))
    .build()
}

describe('GET /powerups/predictions/friends', () => {
  it('before tournament start → available: false with availableAt', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const futureMatch = await buildFutureMatch()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/friends',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(false)
    expect(body.data).toBeNull()
    expect(new Date(body.availableAt).getTime()).toBeCloseTo(futureMatch.scheduledAt.getTime(), -3)
  })

  it('after tournament start → available: true with friends data', async () => {
    const server = await buildServer()
    const { participant: me, cookie } = await createAuthenticatedParticipant()
    const { participant: friend } = await createAuthenticatedParticipant()
    await buildPastMatch()
    await new PowerupBuilder().build(friend.id)

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/friends',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(true)
    expect(body.availableAt).toBeNull()
    expect(Array.isArray(body.data)).toBe(true)

    const friendEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === friend.id)
    expect(friendEntry).toBeDefined()
    expect(friendEntry.darkHorse).not.toBeNull()
    expect(friendEntry.disappointment).not.toBeNull()

    const myEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === me.id)
    expect(myEntry).toBeUndefined()
  })

  it('friend with no powerups → darkHorse and disappointment are null', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const { participant: friend } = await createAuthenticatedParticipant()
    await buildPastMatch()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/friends',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(true)
    const friendEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === friend.id)
    expect(friendEntry.darkHorse).toBeNull()
    expect(friendEntry.disappointment).toBeNull()
  })

  it('no match in DB → available: false with availableAt: null', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/friends',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(false)
    expect(body.availableAt).toBeNull()
  })

  it('no auth → 401', async () => {
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/friends',
    })

    expect(res.statusCode).toBe(401)
  })
})
