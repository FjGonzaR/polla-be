import { prisma } from '../lib/prisma.js'
import { toGroupDto, type GroupDto } from '../mappers/group.mapper.js'

export async function findAllGroups(): Promise<GroupDto[]> {
  const groups = await prisma.group.findMany({
    include: { teams: true },
    orderBy: { label: 'asc' },
  })
  return groups.map(toGroupDto)
}
