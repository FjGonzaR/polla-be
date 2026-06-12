import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { buildMatchPredictionStat } from '../builders/match-prediction-stat.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

const PAST = new Date(Date.now() - 86_400_000)
const FUTURE = new Date(Date.now() + 86_400_000)

describe('KO match stats in /ko/matches', () => {
  it('started match with stat row → stats populated in list', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(PAST).build()
    await buildMatchPredictionStat({
      matchId: match.id,
      totalPredictions: 10,
      pctHomeWin: 60,
      pctDraw: 10,
      pctAwayWin: 30,
      pctTripleActive: 20,
      topScoreHome: 2,
      topScoreAway: 1,
      topScorePct: 40,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const stats = res.json().matches[0].stats
    expect(stats).not.toBeNull()
    expect(stats.totalPredictions).toBe(10)
    expect(stats.pctHomeWin).toBe(60)
    expect(stats.pctDraw).toBe(10)
    expect(stats.pctAwayWin).toBe(30)
    expect(stats.pctTripleActive).toBe(20)
    expect(stats.topScore).toEqual({ home: 2, away: 1, pct: 40 })
  })

  it('started match with stat row → stats populated in detail', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(PAST).build()
    await buildMatchPredictionStat({ matchId: match.id, totalPredictions: 5 })

    const res = await server.inject({
      method: 'GET',
      url: `/ko/matches/${match.id}`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().stats).not.toBeNull()
    expect(res.json().stats.totalPredictions).toBe(5)
  })

  it('not-started match → stats null even when a stat row exists', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const match = await new MatchBuilder().withRoundSlug('R32').withScheduledAt(FUTURE).build()
    await buildMatchPredictionStat({ matchId: match.id })

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().matches[0].stats).toBeNull()
  })

  it('started match with no stat row → stats null (no crash)', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    await new MatchBuilder().withRoundSlug('R32').withScheduledAt(PAST).build()

    const res = await server.inject({
      method: 'GET',
      url: '/ko/matches?roundSlug=R32',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().matches[0].stats).toBeNull()
  })
})
