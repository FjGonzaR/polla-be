import { describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { buildKoPrediction } from '../builders/ko-prediction.builder.js'
import { MatchBuilder } from '../builders/match.builder.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { recalculateScores } from '../../crons/recalculate-scores.js'

describe('recalculateScores', () => {
  it('no participants → resolves without error, no score events written', async () => {
    await recalculateScores()

    const count = await prisma.scoreEvent.count()
    expect(count).toBe(0)
  })

  it('correct group predictions + finalized standings → creates pts_group_position_exact events', async () => {
    await seedScoringParams()
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()
    const [t1, t2, t3, t4] = await Promise.all([
      new TeamBuilder().withName('T1').withCode('T1C').withGroupId(group.id).build(),
      new TeamBuilder().withName('T2').withCode('T2C').withGroupId(group.id).build(),
      new TeamBuilder().withName('T3').withCode('T3C').withGroupId(group.id).build(),
      new TeamBuilder().withName('T4').withCode('T4C').withGroupId(group.id).build(),
    ])

    // Standings with real positions set
    await prisma.groupStanding.createMany({
      data: [
        { teamId: t1.id, groupId: group.id, realPosition: 1, pts: 9, goalsFor: 7, goalsAgainst: 2, matchesPlayed: 3, qualifiedAsThird: false },
        { teamId: t2.id, groupId: group.id, realPosition: 2, pts: 6, goalsFor: 4, goalsAgainst: 3, matchesPlayed: 3, qualifiedAsThird: false },
        { teamId: t3.id, groupId: group.id, realPosition: 3, pts: 3, goalsFor: 2, goalsAgainst: 4, matchesPlayed: 3, qualifiedAsThird: false },
        { teamId: t4.id, groupId: group.id, realPosition: 4, pts: 0, goalsFor: 1, goalsAgainst: 5, matchesPlayed: 3, qualifiedAsThird: false },
      ],
    })

    const participant = await buildParticipant()
    // Predict all 4 positions correctly
    await prisma.groupPrediction.createMany({
      data: [
        { participantId: participant.id, groupId: group.id, teamId: t1.id, predictedPosition: 1 },
        { participantId: participant.id, groupId: group.id, teamId: t2.id, predictedPosition: 2 },
        { participantId: participant.id, groupId: group.id, teamId: t3.id, predictedPosition: 3 },
        { participantId: participant.id, groupId: group.id, teamId: t4.id, predictedPosition: 4 },
      ],
    })

    await recalculateScores()

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events.some((e) => e.paramKey === 'pts_group_position_exact')).toBe(true)
    // 4 exact predictions × 3 pts = 12
    const groupEvent = events.find((e) => e.paramKey === 'pts_group_position_exact')
    expect(groupEvent?.points).toBe(12)
    // All 4 correct → bonus_group_complete
    expect(events.some((e) => e.paramKey === 'bonus_group_complete')).toBe(true)
  })

  it('correct KO prediction (advances + exact score) → creates pts_ko_advances and pts_ko_exact_score events', async () => {
    await seedScoringParams()
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()
    const home = await new TeamBuilder().withName('Home FC').withCode('HFC').withGroupId(group.id).build()
    const away = await new TeamBuilder().withName('Away FC').withCode('AFC').withGroupId(group.id).build()

    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withResult(2, 1, home.id)
      .build()

    const participant = await buildParticipant()
    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: home.id,
      scoreHome: 2,
      scoreAway: 1,
      tripleActive: false,
    })

    await recalculateScores()

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events.some((e) => e.paramKey === 'pts_ko_advances')).toBe(true)
    expect(events.some((e) => e.paramKey === 'pts_ko_exact_score')).toBe(true)
    // scale_r32=1, pts_ko_advances=4, pts_ko_exact_score=6
    expect(events.find((e) => e.paramKey === 'pts_ko_advances')?.points).toBe(4)
    expect(events.find((e) => e.paramKey === 'pts_ko_exact_score')?.points).toBe(6)
  })

  it('full recalculate wipes stale score events and writes fresh ones', async () => {
    await seedScoringParams()
    const participant = await buildParticipant()

    // Seed a stale score event
    await prisma.scoreEvent.create({
      data: {
        participantId: participant.id,
        paramKey: 'pts_group_position_exact',
        matchId: null,
        groupId: null,
        roundSlug: null,
        points: 999,
      },
    })

    // No predictions → recalculate produces 0 events for this participant
    await recalculateScores()

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events).toHaveLength(0)
  })

  it('triple_active + wrong exact score (correct advance) → zero points for that match', async () => {
    await seedScoringParams()
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()
    const home = await new TeamBuilder().withName('Home FC').withCode('HFC').withGroupId(group.id).build()
    const away = await new TeamBuilder().withName('Away FC').withCode('AFC').withGroupId(group.id).build()

    // Match result: 2-1, home wins
    const match = await new MatchBuilder()
      .withRoundSlug('R32')
      .withHomeTeamId(home.id)
      .withAwayTeamId(away.id)
      .withResult(2, 1, home.id)
      .build()

    const participant = await buildParticipant()
    // Correct advancing team, but wrong scores → triple-or-nothing → 0 pts
    await buildKoPrediction({
      participantId: participant.id,
      matchId: match.id,
      teamAdvancesId: home.id,
      scoreHome: 1,
      scoreAway: 0,
      tripleActive: true,
    })

    await recalculateScores()

    const events = await prisma.scoreEvent.findMany({ where: { participantId: participant.id } })
    expect(events).toHaveLength(0)
  })
})
