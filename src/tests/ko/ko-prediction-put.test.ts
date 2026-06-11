import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

async function buildKoMatchWithPrediction(participantId: string) {
  const homeTeam = await new TeamBuilder().build()
  const awayTeam = await new TeamBuilder().build()
  const match = await new MatchBuilder()
    .withRoundSlug('R32')
    .withHomeTeamId(homeTeam.id)
    .withAwayTeamId(awayTeam.id)
    .build()
  const prediction = await buildKoPrediction({
    participantId,
    matchId: match.id,
    teamAdvancesId: homeTeam.id,
    scoreHome: 1,
    scoreAway: 0,
  })
  return { match, homeTeam, awayTeam, prediction }
}

describe('PUT /ko/matches/:matchId/predictions', () => {
  it('success → 200, ok=true, DB updated', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatchWithPrediction(participant.id)

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 3, scoreAway: 2, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(res.json().tripleUsesRemaining).toBe(3)

    const row = await prisma.koPrediction.findUnique({
      where: { participantId_matchId: { participantId: participant.id, matchId: match.id } },
    })
    expect(row!.scoreHome).toBe(3)
    expect(row!.scoreAway).toBe(2)
  })

  it('activate triple (false→true) when uses available → 200, tripleUsesRemaining=2', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatchWithPrediction(participant.id)

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, teamAdvancesId: homeTeam.id, tripleActive: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().tripleUsesRemaining).toBe(2)
  })

  it('deactivate triple (true→false) → 200, frees a use', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .build()
    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
      tripleActive: true,
    })

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().tripleUsesRemaining).toBe(3)
  })

  it('match not found → 404 MATCH_NOT_FOUND', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'PUT',
      url: '/ko/matches/00000000-0000-0000-0000-000000000000/predictions',
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: participant.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('MATCH_NOT_FOUND')
  })

  it('prediction not found → 404 PREDICTION_NOT_FOUND', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .build()

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('PREDICTION_NOT_FOUND')
  })

  it('match locked → 423 MATCH_LOCKED', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    // scheduledAt 1 min ago → lock threshold (scheduledAt) already passed
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withScheduledAt(new Date(Date.now() - 60 * 1000))
      .build()
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: homeTeam.id })

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('MATCH_LOCKED')
  })

  it('match finished → 423 MATCH_FINISHED', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(1, 0, homeTeam.id)
      .build()
    await buildKoPrediction({ participantId: participant.id, matchId: match.id, teamAdvancesId: homeTeam.id })

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 1, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('MATCH_FINISHED')
  })

  it('teamAdvancesId not in match → 400 INVALID_TEAM_ADVANCES', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, homeTeam } = await buildKoMatchWithPrediction(participant.id)
    const otherTeam = await new TeamBuilder().build()

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: otherTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_TEAM_ADVANCES')
  })

  it('activate triple when 3 already used on other matches → 400 TRIPLE_USES_EXHAUSTED', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    // Burn 3 triples on other matches
    for (let i = 0; i < 3; i++) {
      const ht = await new TeamBuilder().build()
      const at = await new TeamBuilder().build()
      const m = await new MatchBuilder()
        .withRoundSlug('R32')
        .withHomeTeamId(ht.id)
        .withAwayTeamId(at.id)
        .build()
      await buildKoPrediction({ participantId: participant.id, matchId: m.id, teamAdvancesId: ht.id, tripleActive: true })
    }

    const { match, homeTeam } = await buildKoMatchWithPrediction(participant.id)

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      headers: { cookie },
      payload: { scoreHome: 2, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: true },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('TRIPLE_USES_EXHAUSTED')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .build()

    const res = await server.inject({
      method: 'PUT',
      url: `/ko/matches/${match.id}/predictions`,
      payload: { scoreHome: 1, scoreAway: 0, teamAdvancesId: homeTeam.id, tripleActive: false },
    })

    expect(res.statusCode).toBe(401)
  })
})
