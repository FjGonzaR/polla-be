import type { Invitation, InvitationStatus, Participant, ParticipantRole, ScoringParam, Team } from '@prisma/client'

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

export interface Top8TeamDto {
  id: string
  name: string
  code: string
}

export function toTop8TeamDto(team: Team): Top8TeamDto {
  return { id: team.id, name: team.name, code: team.code }
}

export interface AdminParticipantDto {
  id: string
  name: string
  email: string
  phone: string | null
  role: ParticipantRole
  totalScore: number
}

export function toAdminParticipantDto(
  participant: Participant,
  totalScore: number,
): AdminParticipantDto {
  return {
    id: participant.id,
    name: participant.name,
    email: participant.email,
    phone: participant.phone,
    role: participant.role,
    totalScore,
  }
}
