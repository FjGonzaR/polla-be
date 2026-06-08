import { MatchStatus, RoundSlug } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { sendWhatsappMessage } from '../lib/whatsapp.client.js'

type MatchWithRelations = Awaited<ReturnType<typeof fetchUpcomingMatches>>[number]

async function fetchUpcomingMatches() {
  const now = new Date()
  const in60min = new Date(now.getTime() + 60 * 60 * 1000)

  return prisma.match.findMany({
    where: {
      status: MatchStatus.SCHEDULED,
      scheduledAt: { gt: now, lte: in60min },
      round: { slug: { not: RoundSlug.GROUP } },
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      koPredictions: { select: { participantId: true } },
      reminders: { select: { participantId: true } },
    },
  })
}

function buildReminderMessage(match: MatchWithRelations): string {
  const home = match.homeTeam?.name ?? 'TBD'
  const away = match.awayTeam?.name ?? 'TBD'
  const time = match.scheduledAt.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  })
  return (
    `⚽ *Polla Mundial 2026* — ¡Falta menos de 1 hora!\n\n` +
    `*${home} vs ${away}*\n` +
    `Hora: ${time} (Colombia)\n\n` +
    `Aún no tienes tu predicción para este partido. ¡Entra a la app antes de que se bloquee!`
  )
}

export async function sendWhatsappReminders(): Promise<void> {
  console.info('[whatsapp-reminder] Running...')

  try {
    const matches = await fetchUpcomingMatches()

    if (matches.length === 0) {
      console.info('[whatsapp-reminder] No matches needing reminders')
      return
    }

    const allParticipants = await prisma.participant.findMany({
      where: { hasPhone: true },
      select: { id: true, phone: true, name: true },
    })

    for (const match of matches) {
      try {
        const predictedIds = new Set(match.koPredictions.map((p) => p.participantId))
        const remindedIds = new Set(match.reminders.map((r) => r.participantId))
        const pending = allParticipants.filter(
          (p) => !predictedIds.has(p.id) && !remindedIds.has(p.id),
        )

        if (pending.length === 0) {
          console.info(`[whatsapp-reminder] Match ${match.id}: all participants done`)
          continue
        }

        console.info(`[whatsapp-reminder] Match ${match.id}: ${pending.length} pending`)
        const message = buildReminderMessage(match)

        for (const participant of pending) {
          try {
            await sendWhatsappMessage(participant.phone!, message)
            await prisma.matchReminder.create({
              data: { matchId: match.id, participantId: participant.id },
            })
            console.info(`[whatsapp-reminder] Sent to ${participant.name}`)
          } catch (err) {
            console.error(
              `[whatsapp-reminder] Failed for ${participant.name}:`,
              (err as Error).message,
            )
          }
        }
      } catch (matchErr) {
        console.error(
          `[whatsapp-reminder] Error processing match ${match.id}:`,
          (matchErr as Error).message,
        )
      }
    }

    console.info('[whatsapp-reminder] Done')
  } catch (error) {
    console.error('[whatsapp-reminder] Fatal error:', (error as Error).message)
  }
}
