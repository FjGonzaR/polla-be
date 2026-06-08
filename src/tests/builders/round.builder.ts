import { type Round, RoundSlug } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class RoundBuilder {
  private name = 'Round of 32'
  private slug: RoundSlug = RoundSlug.R32
  private order = 1
  private matchCount = 16

  withSlug(slug: RoundSlug): this {
    this.slug = slug
    return this
  }

  withName(name: string): this {
    this.name = name
    return this
  }

  withOrder(order: number): this {
    this.order = order
    return this
  }

  withMatchCount(matchCount: number): this {
    this.matchCount = matchCount
    return this
  }

  async build(): Promise<Round> {
    return prisma.round.create({
      data: { name: this.name, slug: this.slug, order: this.order, matchCount: this.matchCount },
    })
  }
}
