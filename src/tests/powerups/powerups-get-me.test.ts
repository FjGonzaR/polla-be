import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { TeamBuilder } from '../builders/team.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { calculatePowerupStats } from '../../crons/calculate-powerup-stats.js'

describe('GET /powerups/predictions/me', () => {
  it('returns powerups when they exist with pct null before cron runs', async () => {
    const server = await buildServer()
    const { participant, cookie } = await createAuthenticatedParticipant()
    await new PowerupBuilder().build(participant.id)

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/me',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.darkHorse).not.toBeNull()
    expect(body.disappointment).not.toBeNull()
    expect(body.darkHorse.isTop8).toBe(false)
    expect(body.darkHorse.flag).toBe('https://flagcdn.com/w80/xx.png')
    expect(body.disappointment.isTop8).toBe(true)
    expect(body.disappointment.flag).toBe('https://flagcdn.com/w80/xx.png')
    expect(body.darkHorse.pct).toBeNull()
    expect(body.disappointment.pct).toBeNull()
  })

  it('returns correct pct after cron runs', async () => {
    const server = await buildServer()
    const dh = await new TeamBuilder().withIsTop8(false).withCode('STATS1').build()
    const dis = await new TeamBuilder().withIsTop8(true).withCode('STATS2').build()

    const [{ participant: p1, cookie }, { participant: p2 }] = await Promise.all([
      createAuthenticatedParticipant(),
      createAuthenticatedParticipant(),
    ])

    await new PowerupBuilder().withDarkHorseTeamId(dh.id).withDisappointmentTeamId(dis.id).build(p1.id)
    await new PowerupBuilder().withDarkHorseTeamId(dh.id).withDisappointmentTeamId(dis.id).build(p2.id)

    await calculatePowerupStats()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/me',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.darkHorse.pct).toBe(100)
    expect(body.disappointment.pct).toBe(100)
  })

  it('returns nulls when no powerups exist', async () => {
    const server = await buildServer()
    const { cookie } = await createAuthenticatedParticipant()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/me',
      headers: { cookie },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ darkHorse: null, disappointment: null })
  })

  it('no auth → 401', async () => {
    const server = await buildServer()

    const res = await server.inject({
      method: 'GET',
      url: '/powerups/predictions/me',
    })

    expect(res.statusCode).toBe(401)
  })
})
