import { InvitationStatus, type Invitation } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

interface InvitationOverrides {
  code?: string
  phone?: string | null
  status?: InvitationStatus
  expiresAt?: Date | null
  usedAt?: Date | null
}

export async function buildInvitation(overrides: InvitationOverrides = {}): Promise<Invitation> {
  return prisma.invitation.create({
    data: {
      code: overrides.code ?? 'TEST-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      phone: overrides.phone ?? null,
      status: overrides.status ?? InvitationStatus.AVAILABLE,
      expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : null,
      usedAt: overrides.usedAt ?? null,
    },
  })
}
