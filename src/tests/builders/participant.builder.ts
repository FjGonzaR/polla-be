import { ParticipantRole, type Participant } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { buildInvitation } from './invitation.builder.js'

interface ParticipantOverrides {
  googleId?: string
  name?: string
  email?: string
  phone?: string | null
  hasPhone?: boolean
  role?: ParticipantRole
  invitationId?: string | null
}

export async function buildParticipant(overrides: ParticipantOverrides = {}): Promise<Participant> {
  const uid = Math.random().toString(36).slice(2, 10)
  const noInvite = overrides.invitationId === null || overrides.role === ParticipantRole.ADMIN
  const invitation = noInvite || overrides.invitationId
    ? undefined
    : await buildInvitation({ status: 'USED' })

  return prisma.participant.create({
    data: {
      googleId: overrides.googleId ?? 'google-' + uid,
      name: overrides.name ?? 'Test User ' + uid,
      email: overrides.email ?? `test-${uid}@example.com`,
      phone: overrides.phone ?? (noInvite ? null : '+573001234567'),
      hasPhone: overrides.hasPhone ?? !noInvite,
      role: overrides.role ?? ParticipantRole.PARTICIPANT,
      invitationId: noInvite ? null : (overrides.invitationId ?? invitation!.id),
    },
  })
}
