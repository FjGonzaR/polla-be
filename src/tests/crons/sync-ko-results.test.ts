import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { syncKoResults } from '../../crons/sync-ko-results.js'
import type { WorldCupMatch } from '../../types/worldcup-api.types.js'

const { mockGetMatch } = vi.hoisted(() => ({
  mockGetMatch: vi.fn(),
}))

vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getMatch: mockGetMatch },
}))

const THREE_HOURS_AGO = new Date(Date.now() - 3 * 60 * 60 * 1000)

async function buildKoMatchForSync(externalMatchId: string, scheduledAt: Date = THREE_HOURS_AGO) {
  const round = await prisma.round.upsert({
    where: { slug: 'R32' },
    create: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
    update: {},
  })
  const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
  const home = await prisma.team.create({
    data: { name: 'Home FC', code: Math.random().toString(36).slice(2, 5).toUpperCase(), groupId: group.id, externalTeamId: 'ext-home' },
  })
  const away = await prisma.team.create({
    data: { name: 'Away FC', code: Math.random().toString(36).slice(2, 5).toUpperCase(), groupId: group.id, externalTeamId: 'ext-away' },
  })
  const match = await prisma.match.create({
    data: {
      roundId: round.id,
      matchNumber: Math.floor(Math.random() * 100_000),
      scheduledAt,
      externalMatchId,
      homeTeamId: home.id,
      awayTeamId: away.id,
    },
  })
  return { match, home, away, round }
}

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
    group: 'R32',
    matchday: '4',
    stadium_id: '16',
    local_date: '06/28/2026 12:00',
    finished: 'TRUE',
    time_elapsed: 'finished',
    type: 'r32',
    ...overrides,
  }
}

describe('syncKoResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finished match with clear winner → status=FINISHED, score+winner set, score events created', async () => {
    await seedScoringParams()
    const { match, home } = await buildKoMatchForSync('ext-match-1')

    const participant = await buildParticipant()
    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: home.id,
      scoreHome: 2,
      scoreAway: 1,
    })

    mockGetMatch.mockResolvedValue(apiMatch())

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('FINISHED')
    expect(updated?.scoreHome).toBe(2)
    expect(updated?.scoreAway).toBe(1)
    expect(updated?.winnerTeamId).toBe(home.id)

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e) => e.paramKey === 'pts_ko_advances')).toBe(true)
    expect(events.some((e) => e.paramKey === 'pts_ko_exact_score')).toBe(true)
  })

  it('draw (penalties) → status=FINISHED, winnerTeamId=null', async () => {
    const { match } = await buildKoMatchForSync('ext-match-draw')

    mockGetMatch.mockResolvedValue(
      apiMatch({ home_score: '1', away_score: '1', home_team_id: 'ext-home', away_team_id: 'ext-away' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('FINISHED')
    expect(updated?.scoreHome).toBe(1)
    expect(updated?.scoreAway).toBe(1)
    expect(updated?.winnerTeamId).toBeNull()
  })

  it('match in progress (finished=FALSE, time_elapsed≠notstarted) → status=LIVE', async () => {
    const { match } = await buildKoMatchForSync('ext-match-live')

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '45' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('LIVE')
  })

  it('match not started (finished=FALSE, time_elapsed=notstarted) → status unchanged', async () => {
    const { match } = await buildKoMatchForSync('ext-match-notstarted')

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: 'notstarted' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('SCHEDULED')
  })

  it('match already LIVE → scoreHome/scoreAway updated when score changes mid-match', async () => {
    const { match } = await buildKoMatchForSync('ext-match-score-update')
    await prisma.match.update({
      where: { id: match.id },
      data: { status: 'LIVE', scoreHome: 1, scoreAway: 0 },
    })

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '60', home_score: '2', away_score: '0' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('LIVE')
    expect(updated?.scoreHome).toBe(2)
    expect(updated?.scoreAway).toBe(0)
  })

  it('match already LIVE → no redundant update when still in progress', async () => {
    const round = await prisma.round.upsert({
      where: { slug: 'R32' },
      create: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
      update: {},
    })
    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id,
        matchNumber: Math.floor(Math.random() * 100_000),
        scheduledAt: THREE_HOURS_AGO,
        externalMatchId: 'ext-match-already-live',
        status: 'LIVE',
        homeTeamId: null,
        awayTeamId: null,
      },
    })

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '60' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('LIVE')
  })

  it('winner team externalTeamId not in DB → match still FINISHED, winnerTeamId=null', async () => {
    const { match } = await buildKoMatchForSync('ext-match-unknown-winner')

    mockGetMatch.mockResolvedValue(
      apiMatch({ home_score: '2', away_score: '1', home_team_id: 'ext-unknown-team', away_team_id: 'ext-away' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    expect(updated?.status).toBe('FINISHED')
    expect(updated?.winnerTeamId).toBeNull()
  })

  it('finished match → scorers updated in additionalData, stadium info preserved', async () => {
    const { match } = await buildKoMatchForSync('ext-match-scorers')
    await prisma.match.update({
      where: { id: match.id },
      data: {
        additionalData: {
          homeScorers: 'null',
          awayScorers: 'null',
          stadiumName: 'MetLife Stadium',
          stadiumCapacity: 82500,
        },
      },
    })

    mockGetMatch.mockResolvedValue(
      apiMatch({ home_score: '3', away_score: '1', home_scorers: "Mbappé 12'; Giroud 40'; Griezmann 90'", away_scorers: "Son 55'" }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    const data = updated?.additionalData as Record<string, unknown>
    expect(data.homeScorers).toBe("Mbappé 12'; Giroud 40'; Griezmann 90'")
    expect(data.awayScorers).toBe("Son 55'")
    expect(data.stadiumName).toBe('MetLife Stadium')
    expect(data.stadiumCapacity).toBe(82500)
  })

  it('live match → scorers also updated in additionalData', async () => {
    const { match } = await buildKoMatchForSync('ext-match-scorers-live')
    await prisma.match.update({
      where: { id: match.id },
      data: { additionalData: { stadiumName: 'Lusail' } },
    })

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '70', home_score: '1', away_score: '0', home_scorers: "Vinícius 65'", away_scorers: 'null' }),
    )

    await syncKoResults()

    const updated = await prisma.match.findUnique({ where: { id: match.id } })
    const data = updated?.additionalData as Record<string, unknown>
    expect(updated?.status).toBe('LIVE')
    expect(data.homeScorers).toBe("Vinícius 65'")
    expect(data.stadiumName).toBe('Lusail')
  })

  it('no matches with externalMatchId scheduled >120min ago → getMatch never called', async () => {
    const THIRTY_MIN_AGO = new Date(Date.now() - 30 * 60 * 1000)
    await buildKoMatchForSync('ext-match-too-recent', THIRTY_MIN_AGO)

    await syncKoResults()

    expect(mockGetMatch).not.toHaveBeenCalled()
  })

  it('API error on one match → error swallowed, other match still processed', async () => {
    const round = await prisma.round.upsert({
      where: { slug: 'R32' },
      create: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
      update: {},
    })
    const group = await prisma.group.create({ data: { name: 'Group A', label: 'A' } })

    const match1 = await prisma.match.create({
      data: {
        roundId: round.id,
        matchNumber: 1,
        scheduledAt: THREE_HOURS_AGO,
        externalMatchId: 'ext-fail',
        homeTeamId: null,
        awayTeamId: null,
      },
    })
    const match2 = await prisma.match.create({
      data: {
        roundId: round.id,
        matchNumber: 2,
        scheduledAt: THREE_HOURS_AGO,
        externalMatchId: 'ext-ok',
        homeTeamId: null,
        awayTeamId: null,
      },
    })

    // Draw result for match2 — no winner team lookup needed
    mockGetMatch.mockImplementation((extId: string) => {
      if (extId === 'ext-fail') return Promise.reject(new Error('API down'))
      return Promise.resolve(
        apiMatch({ home_score: '1', away_score: '1', home_team_id: 'ext-x', away_team_id: 'ext-y' }),
      )
    })

    await syncKoResults()

    const updated1 = await prisma.match.findUnique({ where: { id: match1.id } })
    const updated2 = await prisma.match.findUnique({ where: { id: match2.id } })

    expect(updated1?.status).toBe('SCHEDULED')
    expect(updated2?.status).toBe('FINISHED')
    expect(updated2?.winnerTeamId).toBeNull()
  })

  it('match goes LIVE → match prediction stat row created from predictions', async () => {
    const { match, home, away } = await buildKoMatchForSync('ext-match-stats-live')

    const p1 = await buildParticipant()
    const p2 = await buildParticipant()
    await buildKoPrediction({ participantId: p1.id, matchId: match.id, teamAdvancesId: home.id, scoreHome: 2, scoreAway: 1 })
    await buildKoPrediction({ participantId: p2.id, matchId: match.id, teamAdvancesId: away.id, scoreHome: 0, scoreAway: 1 })

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '45', home_score: '0', away_score: '0', home_scorers: 'null', away_scorers: 'null' }),
    )

    await syncKoResults()

    const stat = await prisma.matchPredictionStat.findUnique({ where: { matchId: match.id } })
    expect(stat).not.toBeNull()
    expect(stat?.totalPredictions).toBe(2)
    expect(stat?.pctHomeWin).toBe(50)
    expect(stat?.pctAwayWin).toBe(50)
    expect(stat?.pctDraw).toBe(0)
  })

  it('stat computation is idempotent → running sync twice keeps a single row', async () => {
    const { match, home } = await buildKoMatchForSync('ext-match-stats-idem')

    const p1 = await buildParticipant()
    await buildKoPrediction({ participantId: p1.id, matchId: match.id, teamAdvancesId: home.id, scoreHome: 1, scoreAway: 0 })

    mockGetMatch.mockResolvedValue(
      apiMatch({ finished: 'FALSE', time_elapsed: '45', home_score: '0', away_score: '0', home_scorers: 'null', away_scorers: 'null' }),
    )

    await syncKoResults()
    await syncKoResults()

    const rows = await prisma.matchPredictionStat.findMany({ where: { matchId: match.id } })
    expect(rows).toHaveLength(1)
  })
})
