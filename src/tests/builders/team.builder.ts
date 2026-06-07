import type { Team } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class TeamBuilder {
  private name = 'Team'
  private code = 'TEM'
  private groupId: string | null = null
  private isTop8 = false

  withName(name: string): this {
    this.name = name
    return this
  }

  withCode(code: string): this {
    this.code = code
    return this
  }

  withGroupId(groupId: string): this {
    this.groupId = groupId
    return this
  }

  withIsTop8(isTop8: boolean): this {
    this.isTop8 = isTop8
    return this
  }

  async build(): Promise<Team> {
    const groupId =
      this.groupId ??
      (
        await prisma.group.create({
          data: { label: Math.random().toString(36).slice(2, 4), name: 'Auto Group' },
        })
      ).id

    return prisma.team.create({
      data: { name: this.name, code: this.code, groupId, isTop8: this.isTop8 },
    })
  }
}
