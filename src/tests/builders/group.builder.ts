import type { Group } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export class GroupBuilder {
  private label = 'A'
  private name = 'Grupo A'

  withLabel(label: string): this {
    this.label = label
    return this
  }

  withName(name: string): this {
    this.name = name
    return this
  }

  async build(): Promise<Group> {
    return prisma.group.create({ data: { label: this.label, name: this.name } })
  }
}
