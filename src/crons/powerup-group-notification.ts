import { prisma } from '../lib/prisma.js'
import { sendWhatsappMessage } from '../lib/whatsapp.client.js'

function buildDarkHorseGroupMessage(teamName: string, groupLabel: string, position: number): string {
  const appUrl = process.env.APP_URL ?? 'https://app.paulpredice.com'
  const teamLine = `*${teamName}* terminó *${position}° en el Grupo ${groupLabel}*`

  let header: string
  let body: string

  if (position === 1) {
    header = '¡Tu promesa está brillando!'
    body = `${teamLine}\n\n¡Sabías lo que hacías! Tu caballo negro lideró su grupo y avanza a la fase KO. 🔥`
  } else if (position === 2) {
    header = '¡Tu promesa clasificó!'
    body = `${teamLine}\n\nNo está nada mal. Tu caballo negro pasa a la fase KO.`
  } else if (position === 3) {
    header = 'Tu promesa terminó tercero...'
    body = `${teamLine}\n\nHabrá que ver si clasifica como mejor tercero. Aún hay esperanza.`
  } else {
    header = 'Tu promesa no pudo ser.'
    body = `${teamLine}\n\nMala noticia: tu caballo negro se despide en grupos. No fue su Mundial.`
  }

  return `🐙 *PaulPredice* — ${header}\n\n⚽ *Polla Mundial 2026*\n${body}\n${appUrl}`
}

export async function sendPowerupGroupNotifications(groupId: string): Promise<void> {
  console.info(`[powerup-group-notification] Checking group ${groupId}...`)

  try {
    const standings = await prisma.groupStanding.findMany({
      where: { groupId },
      include: { team: true, group: true },
    })

    if (standings.length === 0) return

    const groupTeamIds = standings.map((s) => s.teamId)

    const powerups = await prisma.powerup.findMany({
      where: {
        darkHorseTeamId: { in: groupTeamIds },
        darkHorseGroupNotifiedAt: null,
      },
      include: {
        participant: { select: { id: true, phone: true, hasPhone: true, name: true } },
      },
    })

    if (powerups.length === 0) return

    for (const powerup of powerups) {
      const { participant } = powerup

      if (!participant.hasPhone || !participant.phone) continue

      const standing = standings.find((s) => s.teamId === powerup.darkHorseTeamId)
      if (!standing?.realPosition) continue

      const message = buildDarkHorseGroupMessage(
        standing.team.name,
        standing.group.label,
        standing.realPosition,
      )

      try {
        await sendWhatsappMessage(participant.phone, message)
        await prisma.powerup.update({
          where: { id: powerup.id },
          data: { darkHorseGroupNotifiedAt: new Date() },
        })
        console.info(`[powerup-group-notification] Sent to ${participant.name}`)
      } catch (err) {
        console.error(
          `[powerup-group-notification] Failed for ${participant.name}:`,
          (err as Error).message,
        )
      }
    }
  } catch (error) {
    console.error(
      '[powerup-group-notification] Fatal error:',
      (error as Error).message,
    )
  }
}
