import { describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { calculatePowerupStats } from '../../crons/calculate-powerup-stats.js'

describe('calculatePowerupStats', () => {
  it('no participants → resolves without error, no stats written', async () => {
    await calculatePowerupStats()

    const count = await prisma.powerupStat.count()
    expect(count).toBe(0)
  })

  it('participants but no powerups → resolves without error, no stats written', async () => {
    await buildParticipant()
    await buildParticipant()

    await calculatePowerupStats()

    const count = await prisma.powerupStat.count()
    expect(count).toBe(0)
  })

  it('computes 100% when all participants chose the same dark horse', async () => {
    const darkHorse = await new TeamBuilder().withIsTop8(false).withCode('DH1').build()
    const disappointment = await new TeamBuilder().withIsTop8(true).withCode('DIS1').build()

    const [p1, p2] = await Promise.all([buildParticipant(), buildParticipant()])

    await new PowerupBuilder()
      .withDarkHorseTeamId(darkHorse.id)
      .withDisappointmentTeamId(disappointment.id)
      .build(p1.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(darkHorse.id)
      .withDisappointmentTeamId(disappointment.id)
      .build(p2.id)

    await calculatePowerupStats()

    const dhStat = await prisma.powerupStat.findUnique({
      where: { teamId_type: { teamId: darkHorse.id, type: 'DARK_HORSE' } },
    })
    expect(dhStat?.pct).toBe(100)

    const disStat = await prisma.powerupStat.findUnique({
      where: { teamId_type: { teamId: disappointment.id, type: 'DISAPPOINTMENT' } },
    })
    expect(disStat?.pct).toBe(100)
  })

  it('computes 50% when participants chose different dark horses', async () => {
    const dh1 = await new TeamBuilder().withIsTop8(false).withCode('DH2').build()
    const dh2 = await new TeamBuilder().withIsTop8(false).withCode('DH3').build()
    const dis = await new TeamBuilder().withIsTop8(true).withCode('DIS2').build()

    const [p1, p2] = await Promise.all([buildParticipant(), buildParticipant()])

    await new PowerupBuilder()
      .withDarkHorseTeamId(dh1.id)
      .withDisappointmentTeamId(dis.id)
      .build(p1.id)
    await new PowerupBuilder()
      .withDarkHorseTeamId(dh2.id)
      .withDisappointmentTeamId(dis.id)
      .build(p2.id)

    await calculatePowerupStats()

    const stat1 = await prisma.powerupStat.findUnique({
      where: { teamId_type: { teamId: dh1.id, type: 'DARK_HORSE' } },
    })
    const stat2 = await prisma.powerupStat.findUnique({
      where: { teamId_type: { teamId: dh2.id, type: 'DARK_HORSE' } },
    })
    expect(stat1?.pct).toBe(50)
    expect(stat2?.pct).toBe(50)
  })

  it('idempotent — running twice produces same rows without duplicates', async () => {
    const dh = await new TeamBuilder().withIsTop8(false).withCode('DH4').build()
    const dis = await new TeamBuilder().withIsTop8(true).withCode('DIS3').build()
    const p1 = await buildParticipant()

    await new PowerupBuilder()
      .withDarkHorseTeamId(dh.id)
      .withDisappointmentTeamId(dis.id)
      .build(p1.id)

    await calculatePowerupStats()
    await calculatePowerupStats()

    const count = await prisma.powerupStat.count()
    expect(count).toBe(2) // one DARK_HORSE + one DISAPPOINTMENT

    const dhStat = await prisma.powerupStat.findUnique({
      where: { teamId_type: { teamId: dh.id, type: 'DARK_HORSE' } },
    })
    expect(dhStat?.pct).toBe(100)
  })
})
