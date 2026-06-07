import type { Match } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class MatchBuilder {
  private scheduledAt = new Date(Date.now() + 86_400_000)
  private lockedAt: Date | null = null

  withScheduledAt(date: Date): this {
    this.scheduledAt = date
    return this
  }

  withLockedAt(date: Date): this {
    this.lockedAt = date
    return this
  }

  async build(): Promise<Match> {
    const round = await prisma.round.upsert({
      where: { slug: 'GROUP' },
      create: { name: 'Group Stage', slug: 'GROUP', order: 1, matchCount: 48, lockedAt: this.lockedAt },
      update: { lockedAt: this.lockedAt },
    })

    const matchNumber = Math.floor(Math.random() * 100_000)
    return prisma.match.create({
      data: { roundId: round.id, matchNumber, scheduledAt: this.scheduledAt },
    })
  }
}
