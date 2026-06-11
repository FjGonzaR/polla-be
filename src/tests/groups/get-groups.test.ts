import { afterEach, describe, it, expect } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { buildServer } from '../../server.js'
import { buildParticipant } from '../builders/participant.builder.js'
import { buildGroupPositionStat } from '../builders/group-position-stat.builder.js'
import { signSession } from '../../lib/session.js'

afterEach(async () => {
  await prisma.groupPositionStat.deleteMany()
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
      data: { name: 'Brasil', code: 'BRA', groupId: groupB.id, flag: 'https://flagcdn.com/w80/br.png' },
    })
    await prisma.team.create({
      data: { name: 'Argentina', code: 'ARG', groupId: groupA.id, flag: 'https://flagcdn.com/w80/ar.png' },
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
    expect(data[0].teams[0].flag).toBe('https://flagcdn.com/w80/ar.png')
    expect(data[0].teams[0].positionStats).toBeNull()
    expect(data[1].teams[0].code).toBe('BRA')
    expect(data[1].teams[0].flag).toBe('https://flagcdn.com/w80/br.png')
    expect(data[1].teams[0].positionStats).toBeNull()
  })

  it('stats calculados → positionStats incluido en cada equipo', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const groupA = await prisma.group.create({ data: { name: 'Grupo A', label: 'A' } })
    const team = await prisma.team.create({
      data: { name: 'Argentina', code: 'ARG', groupId: groupA.id, flag: null },
    })
    await buildGroupPositionStat({ teamId: team.id, position: 1, pct: 75.5 })
    await buildGroupPositionStat({ teamId: team.id, position: 2, pct: 24.5 })

    const server = await buildServer()
    const res = await server.inject({
      method: 'GET',
      url: '/groups',
      cookies: { session: token },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    const stats = data[0].teams[0].positionStats as Array<{ position: number; pct: number }>
    expect(stats).not.toBeNull()
    expect(stats).toHaveLength(2)
    const pos1 = stats.find((s) => s.position === 1)
    expect(pos1?.pct).toBe(75.5)
  })

  it('grupo con lockedAt pasado → locked: true en respuesta', async () => {
    const participant = await buildParticipant()
    const token = signSession({ userId: participant.id })

    const groupA = await prisma.group.create({
      data: { name: 'Grupo A', label: 'A', lockedAt: new Date(Date.now() - 1000) },
    })
    const groupB = await prisma.group.create({ data: { name: 'Grupo B', label: 'B' } })
    await prisma.team.create({ data: { name: 'Argentina', code: 'ARG', groupId: groupA.id } })
    await prisma.team.create({ data: { name: 'Brasil', code: 'BRA', groupId: groupB.id } })

    const server = await buildServer()
    const res = await server.inject({ method: 'GET', url: '/groups', cookies: { session: token } })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data[0].label).toBe('A')
    expect(data[0].locked).toBe(true)
    expect(data[1].label).toBe('B')
    expect(data[1].locked).toBe(false)
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
