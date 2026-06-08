import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

async function buildTeamPair() {
  const darkHorse = await new TeamBuilder().withIsTop8(false).build()
  const disappointment = await new TeamBuilder().withIsTop8(true).build()
  return { darkHorse, disappointment }
}

describe('POST /powerups/predictions', () => {
  it('success → 201 + record in DB', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    const { darkHorse, disappointment } = await buildTeamPair()

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: { darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappointment.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      darkHorse: { teamId: darkHorse.id, name: darkHorse.name, code: darkHorse.code, isTop8: false, flag: darkHorse.flag },
      disappointment: { teamId: disappointment.id, name: disappointment.name, code: disappointment.code, isTop8: true, flag: disappointment.flag },
    })

    const row = await prisma.powerup.findUnique({ where: { participantId: participant.id } })
    expect(row).not.toBeNull()
    expect(row!.darkHorseTeamId).toBe(darkHorse.id)
    expect(row!.disappointmentTeamId).toBe(disappointment.id)
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const { darkHorse, disappointment } = await buildTeamPair()

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      payload: { darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappointment.id },
    })

    expect(res.statusCode).toBe(401)
  })

  it('dark horse team with isTop8=true → 400 INVALID_DARK_HORSE', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const top8Team = await new TeamBuilder().withIsTop8(true).build()
    const disappointment = await new TeamBuilder().withIsTop8(true).build()

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: { darkHorseTeamId: top8Team.id, disappointmentTeamId: disappointment.id },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_DARK_HORSE')
  })

  it('disappointment team with isTop8=false → 400 INVALID_DISAPPOINTMENT', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const darkHorse = await new TeamBuilder().withIsTop8(false).build()
    const nonTop8 = await new TeamBuilder().withIsTop8(false).build()

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: { darkHorseTeamId: darkHorse.id, disappointmentTeamId: nonTop8.id },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_DISAPPOINTMENT')
  })

  it('powerups already exist → 409 POWERUPS_ALREADY_EXISTS', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    await new PowerupBuilder().build(participant.id)
    const { darkHorse, disappointment } = await buildTeamPair()

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: { darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappointment.id },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('POWERUPS_ALREADY_EXISTS')
  })

  it('group phase locked → 423 PREDICTIONS_LOCKED', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()
    const { darkHorse, disappointment } = await buildTeamPair()

    await prisma.round.upsert({
      where: { slug: 'GROUP' },
      create: { name: 'Group Stage', slug: 'GROUP', order: 1, matchCount: 48, lockedAt: new Date(Date.now() - 1000) },
      update: { lockedAt: new Date(Date.now() - 1000) },
    })

    const res = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: { darkHorseTeamId: darkHorse.id, disappointmentTeamId: disappointment.id },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('PREDICTIONS_LOCKED')
  })
})
