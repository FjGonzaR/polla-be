import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { persistKoMatchScoreEvents } from '../../services/score-calculation.service.js'

// Colombia KO multiplier: mult_colombia_ko (default 5) multiplies the points
// earned on KO matches Colombia plays. It stacks multiplicatively with the
// triple-or-nothing multiplier (mult_triple). With the shared helper defaults
// (pts_ko_advances=4, pts_ko_exact_score=6, scale_r32=1, mult_triple=3,
// mult_colombia_ko=5) a fully-correct R32 prediction has base = (4 + 6) * 1 = 10.

async function buildColombiaKoMatch(overrides: {
  matchNumber: number
  scoreHome: number
  scoreAway: number
  winnerIsColombia: boolean
}) {
  const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
  const grp = await prisma.group.create({ data: { name: 'Group COL', label: 'C' } })
  const colombia = await prisma.team.create({ data: { name: 'Colombia', code: 'COL', groupId: grp.id } })
  const rival = await prisma.team.create({ data: { name: 'Rival', code: 'RIV', groupId: grp.id } })
  const match = await prisma.match.create({
    data: {
      roundId: round.id,
      matchNumber: overrides.matchNumber,
      scheduledAt: new Date('2026-07-05'),
      homeTeamId: colombia.id,
      awayTeamId: rival.id,
      scoreHome: overrides.scoreHome,
      scoreAway: overrides.scoreAway,
      winnerTeamId: overrides.winnerIsColombia ? colombia.id : rival.id,
      status: 'FINISHED',
    },
  })
  return { match, colombia, rival }
}

async function getKoBreakdown(participantId: string, cookie: string): Promise<number> {
  const server = await buildServer()
  const res = await server.inject({
    method: 'GET',
    url: `/scoreboard/${participantId}/breakdown`,
    headers: { cookie },
  })
  expect(res.statusCode).toBe(200)
  return res.json().breakdown.ko
}

describe('Colombia KO x5 multiplier', () => {
  it('Colombia KO match, non-triple, fully correct → base x5', async () => {
    await seedScoringParams()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, colombia } = await buildColombiaKoMatch({
      matchNumber: 1, scoreHome: 2, scoreAway: 0, winnerIsColombia: true,
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: false },
    })

    await persistKoMatchScoreEvents(match.id)

    // base = (4 + 6) * 1 = 10 → x5 = 50
    expect(await getKoBreakdown(participant.id, cookie)).toBe(50)
  })

  it('Colombia KO match + triple, fully correct → base x15', async () => {
    await seedScoringParams()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, colombia } = await buildColombiaKoMatch({
      matchNumber: 2, scoreHome: 1, scoreAway: 0, winnerIsColombia: true,
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    // base 10 → x5 (Colombia) x3 (triple) = 150
    expect(await getKoBreakdown(participant.id, cookie)).toBe(150)
  })

  it('Colombia KO match + triple, wrong score → 0 (triple-or-nothing)', async () => {
    await seedScoringParams()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, colombia } = await buildColombiaKoMatch({
      matchNumber: 3, scoreHome: 3, scoreAway: 0, winnerIsColombia: true,
    })
    // advances correct, score wrong, triple active → whole match scores 0
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 1, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: true },
    })

    await persistKoMatchScoreEvents(match.id)

    expect(await getKoBreakdown(participant.id, cookie)).toBe(0)
  })

  it('Colombia KO match, non-triple, advances only (wrong score) → advances x5', async () => {
    await seedScoringParams()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, colombia } = await buildColombiaKoMatch({
      matchNumber: 4, scoreHome: 2, scoreAway: 1, winnerIsColombia: true,
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 5, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: false },
    })

    await persistKoMatchScoreEvents(match.id)

    // base = advances only = 4 * 1 = 4 → x5 = 20
    expect(await getKoBreakdown(participant.id, cookie)).toBe(20)
  })

  it('mult_colombia_ko = 1 disables the bonus (behaves like a normal match)', async () => {
    await seedScoringParams({ mult_colombia_ko: 1 })
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { match, colombia } = await buildColombiaKoMatch({
      matchNumber: 5, scoreHome: 2, scoreAway: 0, winnerIsColombia: true,
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: false },
    })

    await persistKoMatchScoreEvents(match.id)

    // base 10, no Colombia bonus → 10
    expect(await getKoBreakdown(participant.id, cookie)).toBe(10)
  })

  it('provisional live Colombia KO match applies x5', async () => {
    await seedScoringParams()
    const { participant, cookie } = await createAuthenticatedParticipant()

    const round = await prisma.round.create({ data: { name: 'R32', slug: 'R32', order: 1, matchCount: 16 } })
    const grp = await prisma.group.create({ data: { name: 'Group LIVE', label: 'V' } })
    const colombia = await prisma.team.create({ data: { name: 'Colombia', code: 'COL', groupId: grp.id } })
    const rival = await prisma.team.create({ data: { name: 'Rival', code: 'RIV', groupId: grp.id } })
    const match = await prisma.match.create({
      data: {
        roundId: round.id, matchNumber: 1, scheduledAt: new Date('2026-07-05'),
        homeTeamId: colombia.id, awayTeamId: rival.id,
        scoreHome: 2, scoreAway: 0, status: 'LIVE',
      },
    })
    await prisma.koPrediction.create({
      data: { participantId: participant.id, matchId: match.id, scoreHome: 2, scoreAway: 0, teamAdvancesId: colombia.id, tripleActive: false },
    })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: `/scoreboard/${participant.id}/breakdown`, headers: { cookie } })
    const body = res.json()
    // Live match → simulated bucket, base 10 → x5 = 50
    expect(body.simulatedBreakdown.ko).toBe(50)
    expect(body.realBreakdown.ko).toBe(0)
  })
})
