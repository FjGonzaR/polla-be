import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { buildScoringParam } from '../builders/scoring-param.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

describe('GET /ko/matches/:matchId', () => {
  it('success → 200 with KoMatch shape', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const homeTeam = await new TeamBuilder().withName('Argentina').withCode('ARG').build()
    const awayTeam = await new TeamBuilder().withName('France').withCode('FRA').build()
    const match = await new MatchBuilder()
      .withRoundSlug('QF')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .build()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(match.id)
    expect(body.homeTeam.code).toBe('ARG')
    expect(body.awayTeam.code).toBe('FRA')
    expect(body.result).toBeNull()
    expect(body.myPrediction).toBeNull()
  })

  it('includes result when match is finished', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('SF')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(1, 0, homeTeam.id)
      .build()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.result.scoreHome).toBe(1)
    expect(body.result.scoreAway).toBe(0)
    expect(body.result.winnerTeamId).toBe(homeTeam.id)
    expect(body.status).toBe('FINISHED')
  })

  it('includes myPrediction with pointsEarned for finished match', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    await buildScoringParam({ key: 'pts_ko_advances', value: 5 })
    await buildScoringParam({ key: 'pts_ko_exact_score', value: 10 })
    await buildScoringParam({ key: 'mult_triple', value: 15 })
    await buildScoringParam({ key: 'scale_sf', value: 2 })

    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('SF')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(1, 0, homeTeam.id)
      .build()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
      scoreHome: 1,
      scoreAway: 0,
    })

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
      headers: { cookie },
    })

    const pred = res.json().myPrediction
    expect(pred.pointsEarned.pts_ko_advances).toBe(5)
    expect(pred.pointsEarned.pts_ko_exact_score).toBe(10)
    expect(pred.pointsEarned.scale_slug).toBe('scale_sf')
    expect(pred.pointsEarned.scale_factor).toBe(2)
    expect(pred.pointsEarned.total).toBe(30)
  })

  it('myPrediction null when no prediction exists', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const match = await new MatchBuilder().withRoundSlug('FINAL').build()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().myPrediction).toBeNull()
  })

  it('unknown matchId → 404 MATCH_NOT_FOUND', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('MATCH_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const match = await new MatchBuilder().withRoundSlug('R16').build()

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
    })

    expect(res.statusCode).toBe(401)
  })
})
