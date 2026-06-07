import { afterAll, afterEach } from 'vitest'
import { prisma } from '../lib/prisma.js'

afterEach(async () => {
  await prisma.participant.deleteMany()
  await prisma.invitation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})
