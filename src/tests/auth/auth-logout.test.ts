import { describe, it, expect } from 'vitest'
import { buildServer } from '../../server.js'

describe('POST /auth/logout', () => {
  it('clears session cookie and returns ok', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/logout',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    expect(cookies.some((c) => c.startsWith('session=;') || c.includes('Max-Age=0'))).toBe(true)
  })
})
