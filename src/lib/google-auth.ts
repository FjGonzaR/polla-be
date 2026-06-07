import { OAuth2Client } from 'google-auth-library'

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

export interface GooglePayload {
  sub: string
  email: string
  name: string
}

export async function verifyGoogleToken(credential: string): Promise<GooglePayload> {
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const p = ticket.getPayload()
  if (!p?.sub) throw new Error('Invalid token payload')
  return {
    sub: p.sub,
    email: p.email ?? '',
    name: p.name ?? p.email ?? 'Usuario',
  }
}
