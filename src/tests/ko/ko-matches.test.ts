import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { buildScoringParam } from '../builders/scoring-param.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

describe('GET /ko/matches', () => {
  it('success → 200 with round and matches array', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    await new MatchBuilder().withRoundSlug('R32').build()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.round.slug).toBe('R32')
    expect(Array.isArray(body.matches)).toBe(true)
    expect(body.matches).toHaveLength(1)
  })

  it('returns match fields correctly', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const homeTeam = await new TeamBuilder().withName('Colombia').withCode('COL').withFlag('https://flagcdn.com/w80/co.png').build()
    const awayTeam = await new TeamBuilder().withName('Brazil').withCode('BRA').withFlag('https://flagcdn.com/w80/br.png').build()
    const futureDate = new Date(Date.now() + 86_400_000)

    await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withScheduledAt(futureDate)
      .build()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const match = res.json().matches[0]
    expect(match.homeTeam.code).toBe('COL')
    expect(match.homeTeam.flag).toBe('https://flagcdn.com/w80/co.png')
    expect(match.awayTeam.code).toBe('BRA')
    expect(match.awayTeam.flag).toBe('https://flagcdn.com/w80/br.png')
    expect(match.homeTeamLabel).toBe('Colombia')
    expect(match.awayTeamLabel).toBe('Brazil')
    expect(match.myPrediction).toBeNull()
  })

  it('includes myPrediction when participant has prediction', async () => {
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
      scoreHome: 2,
      scoreAway: 1,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const pred = res.json().matches[0].myPrediction
    expect(pred).not.toBeNull()
    expect(pred.scoreHome).toBe(2)
    expect(pred.scoreAway).toBe(1)
    expect(pred.teamAdvancesId).toBe(homeTeam.id)
    expect(pred.tripleActive).toBe(false)
    expect(pred.pointsEarned).toBeNull()
  })

  it('myPrediction.lockedIn = true when match scheduled within 30 min', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    // scheduledAt 29 min from now → lock time (scheduledAt - 30min) was 1 min ago
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withScheduledAt(new Date(Date.now() + 29 * 60 * 1000))
      .build()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.json().matches[0].myPrediction.lockedIn).toBe(true)
  })

  it('myPrediction.pointsEarned populated for finished match', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    await buildScoringParam({ key: 'pts_ko_advances', value: 5 })
    await buildScoringParam({ key: 'pts_ko_exact_score', value: 10 })
    await buildScoringParam({ key: 'mult_triple', value: 15 })
    await buildScoringParam({ key: 'scale_r32', value: 1 })

    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(2, 1, homeTeam.id)
      .build()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
      scoreHome: 2,
      scoreAway: 1,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    const pts = res.json().matches[0].myPrediction.pointsEarned
    expect(pts).not.toBeNull()
    expect(pts.pts_ko_advances).toBe(5)
    expect(pts.pts_ko_exact_score).toBe(10)
    expect(pts.scale_slug).toBe('scale_r32')
    expect(pts.total).toBe(15)
  })

  it('triple-or-nothing → 0 total when tripleActive and score wrong', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()

    await buildScoringParam({ key: 'pts_ko_advances', value: 5 })
    await buildScoringParam({ key: 'pts_ko_exact_score', value: 10 })
    await buildScoringParam({ key: 'mult_triple', value: 15 })
    await buildScoringParam({ key: 'scale_r32', value: 1 })

    const homeTeam = await new TeamBuilder().build()
    const awayTeam = await new TeamBuilder().build()
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(homeTeam.id)
      .withAwayTeamId(awayTeam.id)
      .withResult(2, 1, homeTeam.id)
      .build()

    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: homeTeam.id,
      scoreHome: 3,
      scoreAway: 0,
      tripleActive: true,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    const pts = res.json().matches[0].myPrediction.pointsEarned
    expect(pts.total).toBe(0)
    expect(pts.pts_ko_advances).toBe(0)
    expect(pts.pts_ko_exact_score).toBe(0)
    expect(pts.mult_triple).toBe(0)
  })

  it('missing roundSlug → 400 VALIDATION_ERROR', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  it('invalid roundSlug → 400 INVALID_ROUND', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=GROUP',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_ROUND')
  })

  it('round not in DB → 404 ROUND_NOT_FOUND', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('ROUND_NOT_FOUND')
  })

  it('no auth → 401', async () => {
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
    })

    expect(res.statusCode).toBe(401)
  })
})
