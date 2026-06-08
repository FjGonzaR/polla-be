import { InvitationStatus, type Invitation } from '@prisma/client'

export interface InvitationDto {
  id: string
  code: string
  status: InvitationStatus
  usedAt: string | null
  expiresAt: string
  createdAt: string
}

export function toInvitationDto(inv: Invitation): InvitationDto {
  return {
    id: inv.id,
    code: inv.code,
    status: inv.status,
    usedAt: inv.usedAt ? inv.usedAt.toISOString() : null,
    expiresAt: inv.expiresAt!.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  }
}
