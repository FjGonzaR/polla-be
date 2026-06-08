import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'
import { PowerupBuilder } from '../builders/powerup.builder.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'

describe('GET /powerups/predictions/me', () => {
  it('returns powerups when they exist', async () => {
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
