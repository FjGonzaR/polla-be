import { InvitationStatus, type Invitation } from '@prisma/client'

export interface InvitationDto {
  id: string
  code: string
  phone: string | null
  status: InvitationStatus
  usedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export function toInvitationDto(inv: Invitation): InvitationDto {
  return {
    id: inv.id,
    code: inv.code,
    phone: inv.phone ?? null,
    status: inv.status,
    usedAt: inv.usedAt ? inv.usedAt.toISOString() : null,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
  }
}
