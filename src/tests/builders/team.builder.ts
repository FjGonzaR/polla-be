import type { Team } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class TeamBuilder {
  private name = 'Team'
  private code = Math.random().toString(36).slice(2, 5).toUpperCase()
  private groupId: string | null = null
  private isTop8 = false
  private flag: string | null = 'https://flagcdn.com/w80/xx.png'

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

  withFlag(flag: string | null): this {
    this.flag = flag
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
      data: { name: this.name, code: this.code, groupId, isTop8: this.isTop8, flag: this.flag },
    })
  }
}
