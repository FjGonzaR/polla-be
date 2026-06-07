import { ParticipantRole, type Participant } from '@prisma/client'
import { signSession } from '../../lib/session.js'
import { buildParticipant } from '../builders/participant.builder.js'

interface AuthHelperOptions {
  googleId?: string
  email?: string
  name?: string
  role?: ParticipantRole
  phone?: string | null
  hasPhone?: boolean
  invitationId?: string
}

interface AuthHelperResult {
  participant: Participant
  cookie: string // 'session=<jwt>' — úsalo directo en headers: { cookie }
}

export async function createAuthenticatedParticipant(
  opts: AuthHelperOptions = {},
): Promise<AuthHelperResult> {
  const participant = await buildParticipant(opts)
  const token = signSession({ userId: participant.id })
  return { participant, cookie: `session=${token}` }
}

export async function createAuthenticatedAdmin(
  opts: AuthHelperOptions = {},
): Promise<AuthHelperResult> {
  return createAuthenticatedParticipant({ ...opts, role: ParticipantRole.ADMIN })
}
