import type { Group } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class GroupBuilder {
  private label = 'A'
  private name = 'Grupo A'
  private lastMatchAt: Date | null = null
  private lockedAt: Date | null = null

  withLabel(label: string): this {
    this.label = label
    return this
  }

  withName(name: string): this {
    this.name = name
    return this
  }

  withLastMatchAt(date: Date): this {
    this.lastMatchAt = date
    return this
  }

  withLockedAt(date: Date): this {
    this.lockedAt = date
    return this
  }

  async build(): Promise<Group> {
    return prisma.group.create({
      data: { label: this.label, name: this.name, lastMatchAt: this.lastMatchAt, lockedAt: this.lockedAt },
    })
  }
}
