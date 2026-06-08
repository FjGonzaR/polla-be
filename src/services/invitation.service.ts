import { InvitationStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { toInvitationDto, type InvitationDto } from '../mappers/invitation.mapper.js'

function generateCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)]
  for (let i = 0; i < 4; i++) code += digits[Math.floor(Math.random() * digits.length)]
  return code
}

export async function createInvitation(): Promise<InvitationDto> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const inv = await prisma.invitation.create({
    data: { code: generateCode(), expiresAt },
  })
  return toInvitationDto(inv)
}

const DEFAULT_PAGE_SIZE = 20

export async function listInvitations(
  status?: InvitationStatus,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<{ data: InvitationDto[]; total: number; page: number; pageSize: number }> {
  const where = status ? { status } : undefined
  const [rows, total] = await prisma.$transaction([
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invitation.count({ where }),
  ])
  return { data: rows.map(toInvitationDto), total, page, pageSize }
}
