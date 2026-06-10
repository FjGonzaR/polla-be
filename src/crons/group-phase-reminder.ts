import { prisma } from '../lib/prisma.js'
import { sendWhatsappMessage } from '../lib/whatsapp.client.js'

const APP_URL = process.env.APP_URL ?? 'https://app.paulpredice.com'

const REMINDER_MESSAGE =
  `🐙 *PaulPredice* — ¡Recuerda llenar tus predicciones!\n\n` +
  `⚽ *Polla Mundial 2026*\n` +
  `El torneo empieza pronto y aún tienes predicciones pendientes en la fase de grupos.\n\n` +
  `¡Entra antes del pitazo inicial!\n${APP_URL}`

async function isGroupPhaseComplete(participantId: string): Promise<boolean> {
  const [groupCount, thirdCount, powerup] = await Promise.all([
    prisma.groupPrediction.count({ where: { participantId } }),
    prisma.thirdPrediction.count({ where: { participantId } }),
    prisma.powerup.findUnique({ where: { participantId }, select: { participantId: true } }),
  ])
  return groupCount === 48 && thirdCount === 8 && powerup !== null
}

export async function sendGroupPhaseReminder(): Promise<void> {
  console.info('[group-phase-reminder] Running...')

  try {
    const participants = await prisma.participant.findMany({
      where: { hasPhone: true, phone: { not: null } },
      select: { id: true, phone: true, name: true },
    })

    let sent = 0

    for (const participant of participants) {
      try {
        const complete = await isGroupPhaseComplete(participant.id)
        if (complete) continue

        await sendWhatsappMessage(participant.phone!, REMINDER_MESSAGE)
        sent++
        console.info(`[group-phase-reminder] Sent to ${participant.name}`)
      } catch (err) {
        console.error(
          `[group-phase-reminder] Failed for ${participant.name}:`,
          (err as Error).message,
        )
      }
    }

    console.info(`[group-phase-reminder] Done — ${sent}/${participants.length} notified`)
  } catch (error) {
    console.error('[group-phase-reminder] Fatal error:', (error as Error).message)
  }
}
