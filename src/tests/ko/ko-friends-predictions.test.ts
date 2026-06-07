import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

async function buildStartedKoMatch() {
  const homeTeam = await new TeamBuilder().build()
  const awayTeam = await new TeamBuilder().build()
  const match = await new MatchBuilder()
    .withRoundSlug('R32')
    .withHomeTeamId(homeTeam.id)
    .withAwayTeamId(awayTeam.id)
    .withScheduledAt(new Date(Date.now() - 3_600_000))
    .build()
  return { match, homeTeam, awayTeam }
}

describe('GET /ko/matches/:matchId/predictions/friends', () => {
  it('match not yet started → 200, available=false, availableAt set, data=null', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const futureDate = new Date(Date.now() + 86_400_000)
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withScheduledAt(futureDate)
      .build()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}/predictions/friends`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(false)
    expect(body.matchId).toBe(match.id)
    expect(body.availableAt).not.toBeNull()
    expect(body.data).toBeNull()
  })

  it('match started, no predictions → available=true, all others with prediction=null', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const friend = await buildParticipant()
    const { match } = await buildStartedKoMatch()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}/predictions/friends`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(true)
    expect(body.availableAt).toBeNull()
    const friendEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === friend.id)
    expect(friendEntry).toBeDefined()
    expect(friendEntry.prediction).toBeNull()
  })

  it('match started, friend predicted → prediction returned', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const friend = await buildParticipant()
    const { match, homeTeam } = await buildStartedKoMatch()

    await buildKoPrediction({
      participantId: friend.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
      scoreHome: 2,
      scoreAway: 1,
      tripleActive: true,
    })

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}/predictions/friends`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(true)
    const friendEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === friend.id)
    expect(friendEntry.prediction).toEqual({
      scoreHome: 2,
      scoreAway: 1,
      teamAdvancesId: homeTeam.id,
      tripleActive: true,
    })
  })

  it('authenticated user own prediction excluded from data', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildStartedKoMatch()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
    })

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}/predictions/friends`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const selfEntry = body.data.find((d: { participant: { id: string } }) => d.participant.id === participant.id)
    expect(selfEntry).toBeUndefined()
  })

  it('match not found → 404 MATCH_NOT_FOUND', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches/00000000-0000-0000-0000-000000000000/predictions/friends',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('MATCH_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const { match } = await buildStartedKoMatch()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}/predictions/friends`,
    })

    expect(res.statusCode).toBe(401)
  })
})
