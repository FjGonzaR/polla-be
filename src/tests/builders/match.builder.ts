import type { Match, RoundSlug } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

const ROUND_DEFAULTS: Record<RoundSlug, { name: string; order: number; matchCount: number }> = {
  GROUP: { name: 'Group Stage', order: 0, matchCount: 48 },
  R32: { name: 'Round of 32', order: 1, matchCount: 16 },
  R16: { name: 'Round of 16', order: 2, matchCount: 8 },
  QF: { name: 'Quarter-finals', order: 3, matchCount: 4 },
  SF: { name: 'Semi-finals', order: 4, matchCount: 2 },
  THIRD: { name: 'Third place', order: 5, matchCount: 1 },
  FINAL: { name: 'Final', order: 6, matchCount: 1 },
}

export class MatchBuilder {
  private scheduledAt = new Date(Date.now() + 86_400_000)
  private lockedAt: Date | null = null
  private roundSlug: RoundSlug = 'GROUP'
  private homeTeamId: string | null = null
  private awayTeamId: string | null = null
  private scoreHome: number | null = null
  private scoreAway: number | null = null
  private winnerTeamId: string | null = null
  private status: 'SCHEDULED' | 'LIVE' | 'FINISHED' = 'SCHEDULED'

  withScheduledAt(date: Date): this {
    this.scheduledAt = date
    return this
  }

  withLockedAt(date: Date): this {
    this.lockedAt = date
    return this
  }

  withRoundSlug(slug: RoundSlug): this {
    this.roundSlug = slug
    return this
  }

  withHomeTeamId(id: string): this {
    this.homeTeamId = id
    return this
  }

  withAwayTeamId(id: string): this {
    this.awayTeamId = id
    return this
  }

  withResult(scoreHome: number, scoreAway: number, winnerTeamId: string): this {
    this.scoreHome = scoreHome
    this.scoreAway = scoreAway
    this.winnerTeamId = winnerTeamId
    this.status = 'FINISHED'
    return this
  }

  async build(): Promise<Match> {
    const defaults = ROUND_DEFAULTS[this.roundSlug]
    const round = await prisma.round.upsert({
      where: { slug: this.roundSlug },
      create: { name: defaults.name, slug: this.roundSlug, order: defaults.order, matchCount: defaults.matchCount, lockedAt: this.lockedAt },
      update: { lockedAt: this.lockedAt },
    })

    const matchNumber = Math.floor(Math.random() * 100_000)
    return prisma.match.create({
      data: {
        roundId: round.id,
        matchNumber,
        scheduledAt: this.scheduledAt,
        lockedAt: this.lockedAt,
        homeTeamId: this.homeTeamId,
        awayTeamId: this.awayTeamId,
        scoreHome: this.scoreHome,
        scoreAway: this.scoreAway,
        winnerTeamId: this.winnerTeamId,
        status: this.status,
      },
    })
  }
}
