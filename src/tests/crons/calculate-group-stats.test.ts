import { describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { GroupBuilder } from '../builders/group.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { calculateGroupStats } from '../../crons/calculate-group-stats.js'

async function predictGroup(
  participantId: string,
  groupId: string,
  rankings: Array<{ teamId: string; position: number }>,
) {
  await prisma.groupPrediction.createMany({
    data: rankings.map((r) => ({
      participantId,
      groupId,
      teamId: r.teamId,
      predictedPosition: r.position,
    })),
  })
}

describe('calculateGroupStats', () => {
  it('no participants → resolves without error, no stats written', async () => {
    await calculateGroupStats()

    const count = await prisma.groupPositionStat.count()
    expect(count).toBe(0)
  })

  it('participants but no predictions → resolves without error, no stats written', async () => {
    await buildParticipant()
    await buildParticipant()

    await calculateGroupStats()

    const count = await prisma.groupPositionStat.count()
    expect(count).toBe(0)
  })

  it('computes correct percentages from predictions', async () => {
    const group = await new GroupBuilder().withLabel('A').withName('Group A').build()
    const [t1, t2, t3, t4] = await Promise.all([
      new TeamBuilder().withCode('T1').withGroupId(group.id).build(),
      new TeamBuilder().withCode('T2').withGroupId(group.id).build(),
      new TeamBuilder().withCode('T3').withGroupId(group.id).build(),
      new TeamBuilder().withCode('T4').withGroupId(group.id).build(),
    ])

    const [p1, p2] = await Promise.all([buildParticipant(), buildParticipant()])

    // Both participants agree on the same order
    await predictGroup(p1.id, group.id, [
      { teamId: t1.id, position: 1 },
      { teamId: t2.id, position: 2 },
      { teamId: t3.id, position: 3 },
      { teamId: t4.id, position: 4 },
    ])
    await predictGroup(p2.id, group.id, [
      { teamId: t1.id, position: 1 },
      { teamId: t2.id, position: 2 },
      { teamId: t3.id, position: 3 },
      { teamId: t4.id, position: 4 },
    ])

    await calculateGroupStats()

    const stat = await prisma.groupPositionStat.findUnique({
      where: { teamId_position: { teamId: t1.id, position: 1 } },
    })
    expect(stat?.pct).toBe(100)

    const count = await prisma.groupPositionStat.count()
    // 4 teams × 4 positions but only 4 unique (teamId, position) pairs were predicted
    expect(count).toBe(4)
  })

  it('computes split percentages when participants disagree', async () => {
    const group = await new GroupBuilder().withLabel('B').withName('Group B').build()
    const [t1, t2, t3, t4] = await Promise.all([
      new TeamBuilder().withCode('B1').withGroupId(group.id).build(),
      new TeamBuilder().withCode('B2').withGroupId(group.id).build(),
      new TeamBuilder().withCode('B3').withGroupId(group.id).build(),
      new TeamBuilder().withCode('B4').withGroupId(group.id).build(),
    ])

    const [p1, p2] = await Promise.all([buildParticipant(), buildParticipant()])

    // p1: t1 first, p2: t2 first
    await predictGroup(p1.id, group.id, [
      { teamId: t1.id, position: 1 },
      { teamId: t2.id, position: 2 },
      { teamId: t3.id, position: 3 },
      { teamId: t4.id, position: 4 },
    ])
    await predictGroup(p2.id, group.id, [
      { teamId: t2.id, position: 1 },
      { teamId: t1.id, position: 2 },
      { teamId: t3.id, position: 3 },
      { teamId: t4.id, position: 4 },
    ])

    await calculateGroupStats()

    const t1pos1 = await prisma.groupPositionStat.findUnique({
      where: { teamId_position: { teamId: t1.id, position: 1 } },
    })
    const t2pos1 = await prisma.groupPositionStat.findUnique({
      where: { teamId_position: { teamId: t2.id, position: 1 } },
    })
    const t3pos3 = await prisma.groupPositionStat.findUnique({
      where: { teamId_position: { teamId: t3.id, position: 3 } },
    })

    expect(t1pos1?.pct).toBe(50)
    expect(t2pos1?.pct).toBe(50)
    expect(t3pos3?.pct).toBe(100)
  })

  it('idempotent — running twice produces same rows without duplicates', async () => {
    const group = await new GroupBuilder().withLabel('C').withName('Group C').build()
    const [t1, t2, t3, t4] = await Promise.all([
      new TeamBuilder().withCode('C1').withGroupId(group.id).build(),
      new TeamBuilder().withCode('C2').withGroupId(group.id).build(),
      new TeamBuilder().withCode('C3').withGroupId(group.id).build(),
      new TeamBuilder().withCode('C4').withGroupId(group.id).build(),
    ])

    const p1 = await buildParticipant()
    await predictGroup(p1.id, group.id, [
      { teamId: t1.id, position: 1 },
      { teamId: t2.id, position: 2 },
      { teamId: t3.id, position: 3 },
      { teamId: t4.id, position: 4 },
    ])

    await calculateGroupStats()
    await calculateGroupStats()

    const count = await prisma.groupPositionStat.count()
    expect(count).toBe(4)

    const stat = await prisma.groupPositionStat.findUnique({
      where: { teamId_position: { teamId: t1.id, position: 1 } },
    })
    expect(stat?.pct).toBe(100)
  })
})
