import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { syncGroupResults } from '../../crons/sync-group-results.js'
import type { WorldCupMatch } from '../../types/worldcup-api.types.js'

const { mockGetMatch } = vi.hoisted(() => ({
  mockGetMatch: vi.fn(),
}))

vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getMatch: mockGetMatch },
}))

const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000

// A timestamp guaranteed to fall inside today's Colombia (UTC-5) day AND in the
// past — the midpoint between today's Colombia midnight and now. Deterministic
// regardless of when the suite runs (no flake near Colombia midnight).
function todayInPlay(): Date {
  const now = Date.now()
  const col = new Date(now - COLOMBIA_OFFSET_MS)
  const dayStart =
    Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate()) + COLOMBIA_OFFSET_MS
  return new Date(Math.floor((dayStart + now) / 2))
}

const TODAY_IN_PLAY = todayInPlay()

function apiMatch(overrides: Partial<WorldCupMatch> = {}): WorldCupMatch {
  return {
    _id: '679c9c8a5749c4077500e073',
    id: '73',
    home_team_id: 'ext-home',
    away_team_id: 'ext-away',
    home_score: '2',
    away_score: '1',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'A',
    matchday: '1',
    stadium_id: '16',
    local_date: '06/14/2026 12:00',
    finished: 'TRUE',
    time_elapsed: 'finished',
    type: 'group',
    ...overrides,
  }
}

describe('syncGroupResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finished group match → status=FINISHED, scores persisted, NO score_events/stats', async () => {
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-group-1')
      .withScheduledAt(TODAY_IN_PLAY)
      .build()

    mockGetMatch.mockResolvedValue(apiMatch({ home_score: '3', away_score: '1' }))

    await syncGroupResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('FINISHED')
    expect(updated?.scoreHome).toBe(3)
    expect(updated?.scoreAway).toBe(1)
    expect(updated?.winnerTeamId).toBeNull()

    // Core guarantee: purely informational, no scoring side effects.
    expect(await prisma.scoreEvent.count()).toBe(0)
    expect(await prisma.matchPredictionStat.count()).toBe(0)
  })

  it('finished group match → group_standings recomputed from the result', async () => {
    const group = await prisma.group.create({ data: { label: 'A', name: 'Group A' } })
    const home = await new TeamBuilder().withCode('HOM').withGroupId(group.id).build()
    const away = await new TeamBuilder().withCode('AWY').withGroupId(group.id).build()

    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withExternalMatchId('ext-group-standings')
      .withScheduledAt(TODAY_IN_PLAY)
      .build()

    mockGetMatch.mockResolvedValue(apiMatch({ home_score: '2', away_score: '0' }))

    await syncGroupResults()

    const homeStanding = await prisma.groupStanding.findUnique({ where: { teamId: home.id } })
    const awayStanding = await prisma.groupStanding.findUnique({ where: { teamId: away.id } })
    expect(homeStanding).toMatchObject({ pts: 3, goalsFor: 2, goalsAgainst: 0, matchesPlayed: 1, realPosition: 1 })
    expect(awayStanding).toMatchObject({ pts: 0, goalsFor: 0, goalsAgainst: 2, matchesPlayed: 1, realPosition: 2 })
  })

  it('in-progress group match → status=LIVE with live scores', async () => {
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-group-live')
      .withScheduledAt(TODAY_IN_PLAY)
      .build()

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '45', home_score: '1', away_score: '0' }),
    )

    await syncGroupResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('LIVE')
    expect(updated?.scoreHome).toBe(1)
    expect(updated?.scoreAway).toBe(0)
    expect(await prisma.scoreEvent.count()).toBe(0)
    expect(await prisma.matchPredictionStat.count()).toBe(0)
  })

  it('KO matches are not touched by this cron', async () => {
    const koMatch = await new MatchBuilder()
      .withRoundSlug('R32')
      .withExternalMatchId('ext-ko')
      .withScheduledAt(TODAY_IN_PLAY)
      .build()

    await syncGroupResults()

    expect(mockGetMatch).not.toHaveBeenCalled()
    const updated = await prisma.match.findUnique({ where: { id: koMatch.id } })
    expect(updated?.status).toBe('SCHEDULED')
  })

  it('API reports notstarted (delayed match) → stays SCHEDULED, no score, no standings', async () => {
    const group = await prisma.group.create({ data: { label: 'A', name: 'Group A' } })
    const home = await new TeamBuilder().withCode('HOM').withGroupId(group.id).build()
    const away = await new TeamBuilder().withCode('AWY').withGroupId(group.id).build()

    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withExternalMatchId('ext-notstarted')
      .withScheduledAt(TODAY_IN_PLAY)
      .build()

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: 'notstarted', home_score: '0', away_score: '0' }),
    )

    await syncGroupResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('SCHEDULED')
    expect(updated?.scoreHome).toBeNull()
    expect(updated?.scoreAway).toBeNull()

    const standings = await prisma.groupStanding.findMany({ where: { groupId: group.id } })
    expect(standings.every((s) => s.pts === 0 && s.matchesPlayed === 0)).toBe(true)
  })

  it('match from a previous day → getMatch never called (outside today window)', async () => {
    const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-yesterday')
      .withScheduledAt(TWO_DAYS_AGO)
      .build()

    await syncGroupResults()

    expect(mockGetMatch).not.toHaveBeenCalled()
  })

  it('match scheduled later today (not kicked off yet) → getMatch never called', async () => {
    const IN_3_HOURS = new Date(Date.now() + 3 * 60 * 60 * 1000)
    await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-future')
      .withScheduledAt(IN_3_HOURS)
      .build()

    await syncGroupResults()

    expect(mockGetMatch).not.toHaveBeenCalled()
  })

  it('finished match → scorers updated in additionalData, stadium info preserved', async () => {
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-group-scorers')
      .withScheduledAt(TODAY_IN_PLAY)
      .withAdditionalData({
        homeScorers: 'null',
        awayScorers: 'null',
        stadiumName: 'Estadio Azteca',
        stadiumCity: 'Ciudad de México',
        stadiumCountry: 'México',
        stadiumCapacity: 87523,
      })
      .build()

    mockGetMatch.mockResolvedValue(
      apiMatch({ home_score: '2', away_score: '1', home_scorers: "Messi 23'; Di María 67'", away_scorers: "Kane 80'" }),
    )

    await syncGroupResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    const data = updated?.additionalData as Record<string, unknown>
    expect(data.homeScorers).toBe("Messi 23'; Di María 67'")
    expect(data.awayScorers).toBe("Kane 80'")
    // Stadium fields untouched.
    expect(data.stadiumName).toBe('Estadio Azteca')
    expect(data.stadiumCapacity).toBe(87523)
  })

  it('live match → scorers also updated in additionalData', async () => {
    const match = await new MatchBuilder()
      .withRoundSlug('GROUP')
      .withExternalMatchId('ext-group-scorers-live')
      .withScheduledAt(TODAY_IN_PLAY)
      .withAdditionalData({ stadiumName: 'Wembley' })
      .build()

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '52', home_score: '1', away_score: '0', home_scorers: "Yamal 50'", away_scorers: 'null' }),
    )

    await syncGroupResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    const data = updated?.additionalData as Record<string, unknown>
    expect(updated?.status).toBe('LIVE')
    expect(data.homeScorers).toBe("Yamal 50'")
    expect(data.awayScorers).toBe('null')
    expect(data.stadiumName).toBe('Wembley')
  })
})
