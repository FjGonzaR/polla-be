import { afterAll, afterEach } from 'vitest'
import { prisma } from '../lib/prisma.js'

afterEach(async () => {
  await prisma.groupPrediction.deleteMany()
  await prisma.koPrediction.deleteMany()
  await prisma.thirdPrediction.deleteMany()
  await prisma.powerup.deleteMany()
  await prisma.groupStanding.deleteMany()
  await prisma.match.deleteMany()
  await prisma.round.deleteMany()
  await prisma.team.deleteMany()
  await prisma.group.deleteMany()
  await prisma.participant.deleteMany()
  await prisma.invitation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})
