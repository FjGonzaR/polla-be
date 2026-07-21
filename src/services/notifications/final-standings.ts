import { prisma } from "../../lib/prisma.js";
import { getScoreboard } from "../scoreboard.service.js";
import {
  deliver,
  appLinkFooter,
  recipientWhere,
  type BroadcastResultDto,
  type Recipient,
} from "./shared.js";

const MEDAL_BY_RANK: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatPrize(prize: number): string {
  return prize.toLocaleString("es-CO");
}

// Builds the final-standings message for one participant. Podium finishers (ranks
// 1-3, which carry a prize) get a personalized congratulations plus the promise
// that we'll reach out to hand over the prize; everyone else gets their final
// position and a thanks-for-playing line. An optional admin `message` is appended.
function buildFinalStandingsMessage(
  name: string,
  rank: number,
  prize: number | null,
  message?: string,
): string {
  const parts: string[] = ["🐙 *PaulPredice*", ""];

  if (prize != null) {
    const medal = MEDAL_BY_RANK[rank] ?? "🏆";
    parts.push(
      `${medal} ¡Felicitaciones, ${name}!`,
      "",
      `Terminaste en la *${rank}° posición* de la Polla Mundial 2026 🏆`,
      `Ganaste un premio de *$${formatPrize(prize)} COP*.`,
      "",
      "Nos pondremos en contacto contigo muy pronto para coordinar la entrega de tu premio. 🎉",
    );
  } else {
    parts.push(
      `Terminaste en la *${rank}° posición* de la Polla Mundial 2026 📊`,
      "",
      "¡Gracias por jugar! Fue un placer tenerte en la polla. Nos vemos en la próxima. ⚽",
    );
  }

  const extra = message?.trim();
  if (extra) parts.push("", extra);

  parts.push("", appLinkFooter());
  return parts.join("\n");
}

export async function sendFinalStandings(
  message: string | undefined,
  participantIds?: string[],
): Promise<BroadcastResultDto> {
  // Ranks/prizes always reflect the full standings; participantIds only narrows
  // who receives the message. "all" ensures participants past the top 10 are included.
  const board = await getScoreboard("", "total", "all");
  const standingById = new Map(
    board.data.map((e) => [e.participant.id, { rank: e.rank, prize: e.prize }]),
  );

  const participants = await prisma.participant.findMany({
    where: recipientWhere(participantIds),
    select: { id: true, name: true, phone: true },
  });

  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const p of participants) {
    const standing = standingById.get(p.id);
    if (!standing) {
      skipped++;
      continue;
    }
    recipients.push({
      name: p.name,
      phone: p.phone!,
      text: buildFinalStandingsMessage(p.name, standing.rank, standing.prize, message),
    });
  }

  const { sent, failed } = await deliver(recipients);
  return { total: participants.length, sent, failed, skipped };
}
