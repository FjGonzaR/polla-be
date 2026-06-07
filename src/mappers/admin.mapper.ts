import type { Invitation, InvitationStatus, Participant, ScoringParam } from '@prisma/client'

export interface InvitationDto {
  id: string
  code: string
  status: InvitationStatus
  usedAt: Date | null
  participant: { id: string; name: string } | null
}

export interface ScoringParamDto {
  key: string
  value: number
  description: string
  updatedAt: Date
}

export function toInvitationDto(
  inv: Invitation & { participant: Pick<Participant, 'id' | 'name'> | null },
): InvitationDto {
  return {
    id: inv.id,
    code: inv.code,
    status: inv.status,
    usedAt: inv.usedAt,
    participant: inv.participant ? { id: inv.participant.id, name: inv.participant.name } : null,
  }
}

export function toScoringParamDto(param: ScoringParam): ScoringParamDto {
  return {
    key: param.key,
    value: Number(param.value),
    description: param.description,
    updatedAt: param.updatedAt,
  }
}
