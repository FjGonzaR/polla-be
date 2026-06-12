import { type Prisma, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'
import { toGroupMatchDto, type GroupMatchDto } from '../mappers/group-match.mapper.js'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Colombia is UTC-5; a calendar day there spans [date 05:00Z, date+1 05:00Z).
const COLOMBIA_UTC_OFFSET_HOURS = 5

function colombiaDayRange(date: string): { start: Date; end: Date } {
  if (!DATE_REGEX.test(date)) {
    throw new AppError(400, 'INVALID_DATE', 'date must be in YYYY-MM-DD format')
  }
  const start = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) {
    throw new AppError(400, 'INVALID_DATE', `Invalid date: ${date}`)
  }
  // Shift the UTC midnight forward by the offset to land on Colombia midnight.
  start.setUTCHours(COLOMBIA_UTC_OFFSET_HOURS)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

export async function findGroupMatches(
  filters: { date?: string; groupId?: string } = {},
): Promise<GroupMatchDto[]> {
  const where: Prisma.MatchWhereInput = {
    round: { slug: RoundSlug.GROUP },
  }

  if (filters.groupId) {
    where.homeTeam = { is: { groupId: filters.groupId } }
  }

  if (filters.date) {
    const { start, end } = colombiaDayRange(filters.date)
    where.scheduledAt = { gte: start, lt: end }
  }

  const matches = await prisma.match.findMany({
    where,
    include: {
      homeTeam: { include: { group: true } },
      awayTeam: { include: { group: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { matchNumber: 'asc' }],
  })

  return matches.map(toGroupMatchDto)
}
