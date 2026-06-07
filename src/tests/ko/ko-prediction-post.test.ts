import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

async function buildKoMatch() {
  const homeTeam = await new TeamBuilder().build()
  const awayTeam = await new TeamBuilder().build()
  const futureLockedAt = new Date(Date.now() + 86_400_000)
  const match = await new MatchBuilder()
    .withRoundSlug('R32')
    .withHomeTeamId(homeTeam.id)
    .withAwayTeamId(awayTeam.id)
    .withLockedAt(futureLockedAt)
    .build()
  return { match, homeTeam, awayTeam }
}

describe('POST /ko/matches/:matchId/predictions', () => {
  it('success → 201, ok=true, tripleUsesRemaining=3, record in DB', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatch()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, teamAdvancesId: homeTeam.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ ok: true, tripleUsesRemaining: 3 })

    const row = await prisma.koPrediction.findUnique({
      where: { participantId_matchId: { participantId: participant.id, matchId: match.id } },
    })
    expect(row).not.toBeNull()
    expect(row!.scoreHome).toBe(2)
    expect(row!.tripleActive).toBe(false)
  })

  it('tripleActive=true → 201, tripleUsesRemaining=2', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatch()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: true },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().tripleUsesRemaining).toBe(2)
  })

  it('match not found → 404 MATCH_NOT_FOUND', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    // need a valid team id for teamAdvancesId shape; use participant.id (uuid format) as dummy
    const res = await server.inject({
      method: 'POST',
      url: '/ko/matches/00000000-0000-0000-0000-000000000000/predictions',
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: participant.id },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('MATCH_NOT_FOUND')
  })

  it('match locked → 423 MATCH_LOCKED', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const pastLockedAt = new Date(Date.now() - 1_000)
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withLockedAt(pastLockedAt)
      .build()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('MATCH_LOCKED')
  })

  it('match finished → 423 MATCH_FINISHED', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(1, 0, homeTeam.id)
      .build()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('MATCH_FINISHED')
  })

  it('teamAdvancesId not in match → 400 INVALID_TEAM_ADVANCES', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const { match } = await buildKoMatch()
    const otherTeam = await new TeamBuilder().build()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: otherTeam.id },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_TEAM_ADVANCES')
  })

  it('tripleActive=true with 3 already used → 400 TRIPLE_USES_EXHAUSTED', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    // Create 3 triple predictions on other matches
    for (let i = 0; i < 3; i++) {
      const homeTeam = await new TeamBuilder().build()
      const awayTeam = await new TeamBuilder().build()
      const m = await new MatchBuilder()
        .withRoundSlug('R32')
        .withHomeTeamId(homeTeam.id)
        .withAwayTeamId(awayTeam.id)
        .build()
      await buildKoPrediction({
        participantId: participant.id,
        matchId: m.id,
        teamAdvancesId: homeTeam.id,
        tripleActive: true,
      })
    }

    const { match, homeTeam } = await buildKoMatch()
    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: true },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('TRIPLE_USES_EXHAUSTED')
  })

  it('prediction already exists → 409 PREDICTION_ALREADY_EXISTS', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatch()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
    })

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 0, teamAdvancesId: homeTeam.id },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('PREDICTION_ALREADY_EXISTS')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const { match, homeTeam } = await buildKoMatch()

    const res = await server.inject({
      method: 'POST',
      url: `/ko/matches/${match.id}/predictions`,
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id },
    })

    expect(res.statusCode).toBe(401)
  })
})
