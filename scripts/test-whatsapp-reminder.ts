/**
 * Quick local smoke test for the WhatsApp reminder cron.
 * Inserts a test participant (if needed) + a KO match starting in 30 min, then runs the cron.
 * Run: npx tsx scripts/test-whatsapp-reminder.ts
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { sendWhatsappReminders } from '../src/crons/whatsapp-reminder.js'
import { waitUntilConnected } from '../src/lib/whatsapp.client.js'

const TEST_PHONE = '+573175027021'

async function ensureParticipant() {
  const existing = await prisma.participant.findFirst({ where: { phone: TEST_PHONE } })
  if (existing) {
    console.log(`Participant already exists: ${existing.name}`)
    return existing
  }

  const invitation = await prisma.invitation.create({
    data: { code: 'TEST-SMOKE-' + Date.now(), status: 'USED', usedAt: new Date() },
  })

  const participant = await prisma.participant.create({
    data: {
      googleId: 'smoke-test-' + Date.now(),
      name: 'Smoke Test',
      email: `smoke-${Date.now()}@test.local`,
      phone: TEST_PHONE,
      hasPhone: true,
      role: 'PARTICIPANT',
      invitationId: invitation.id,
    },
  })

  console.log(`Created participant: ${participant.name} (${participant.phone})`)
  return participant
}

async function main() {
  console.log('=== WhatsApp Reminder Smoke Test ===\n')

  await ensureParticipant()

  // Upsert R32 round
  const round = await prisma.round.upsert({
    where: { slug: 'R32' },
    create: { name: 'Round of 32', slug: 'R32', order: 1, matchCount: 16 },
    update: {},
  })

  // Match starting in 30 min
  const scheduledAt = new Date(Date.now() + 30 * 60 * 1000)
  const match = await prisma.match.create({
    data: { roundId: round.id, matchNumber: 99999, scheduledAt, status: 'SCHEDULED' },
  })
  console.log(`Test match created — scheduled at ${scheduledAt.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' })} (Colombia)\n`)

  console.log('Waiting for WhatsApp connection — scan the QR above with your phone...')
  console.log('(WhatsApp → Dispositivos vinculados → Vincular un dispositivo)\n')

  try {
    await waitUntilConnected(120_000) // 2 min to scan
    console.log('Connected! Running reminder cron...\n')
  } catch (err) {
    console.error((err as Error).message)
    await cleanup(match.id)
    process.exit(1)
  }

  await sendWhatsappReminders()

  const reminders = await prisma.matchReminder.findMany({ where: { matchId: match.id } })
  console.log(`\nMatchReminder rows created: ${reminders.length}`)
  reminders.length
    ? console.log('✓ Message sent successfully')
    : console.log('✗ No reminders created — check logs above')

  await cleanup(match.id)
  process.exit(0)
}

async function cleanup(matchId: string) {
  await prisma.matchReminder.deleteMany({ where: { matchId } })
  await prisma.match.delete({ where: { id: matchId } })
  await prisma.$disconnect()
  console.log('\nTest match cleaned up.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
