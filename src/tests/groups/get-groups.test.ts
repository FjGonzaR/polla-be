import { afterEach, describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildServer } from '../../server.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { signSession } from '../../lib/session.js'

afterEach(async () => {
  await prisma.team.deleteMany()
  await prisma.group.deleteMany()
})

describe('GET /groups', () => {
  it('sin grupos en BD → 200 data vacía', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups',
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [] })
  })

  it('grupos con equipos → 200 con teams incluidos, orden label asc', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const groupB = await prisma.group.create({ data: { name: 'Grupo B', label: 'B' } })
    const groupA = await prisma.group.create({ data: { name: 'Grupo A', label: 'A' } })
    await prisma.team.create({
      data: { name: 'Brasil', code: 'BRA', groupId: groupB.id },
    })
    await prisma.team.create({
      data: { name: 'Argentina', code: 'ARG', groupId: groupA.id },
    })

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups',
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(2)
    expect(data[0].label).toBe('A')
    expect(data[1].label).toBe('B')
    expect(data[0].teams).toHaveLength(1)
    expect(data[0].teams[0].code).toBe('ARG')
    expect(data[1].teams[0].code).toBe('BRA')
  })

  it('sin cookie → 401 MISSING_SESSION', async () => {
    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups',
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('MISSING_SESSION')
  })
})
