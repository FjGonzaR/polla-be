import { prisma } from "../../lib/prisma.js";
import { getScoreboard } from "../scoreboard.service.js";
import {
  deliver,
  appLinkFooter,
  recipientWhere,
  type BroadcastResultDto,
  type Recipient,
} from "./shared.js";

export async function sendGroupPhaseLastRoundReminder(
  body: string,
  participantIds?: string[],
): Promise<BroadcastResultDto> {
  // Ranks always reflect the full standings; participantIds only narrows who receives the message.
  const rankById = new Map(
    (await getScoreboard("")).data.map((e) => [e.participant.id, e.rank]),
  );
  const participants = await prisma.participant.findMany({
    where: recipientWhere(participantIds),
    select: { id: true, name: true, phone: true },
  });

  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const p of participants) {
    const position = rankById.get(p.id);
    if (position == null) {
      skipped++;
      continue;
    }
    recipients.push({
      name: p.name,
      phone: p.phone!,
      text: `🐙 *PaulPredice*\n\nVas en la *posición ${position}* de la polla 📊\n\n${body}\n\n${appLinkFooter()}`,
    });
  }
  const { sent, failed } = await deliver(recipients);
  return { total: participants.length, sent, failed, skipped };
}
