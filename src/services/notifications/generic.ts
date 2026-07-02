import { prisma } from "../../lib/prisma.js";
import {
  deliver,
  appLinkFooter,
  pickCta,
  recipientWhere,
  type BroadcastResultDto,
  type Recipient,
} from "./shared.js";

export async function sendGenericBroadcast(
  body: string,
  participantIds?: string[],
): Promise<BroadcastResultDto> {
  const participants = await prisma.participant.findMany({
    where: recipientWhere(participantIds),
    select: { name: true, phone: true },
  });
  const recipients: Recipient[] = participants.map((p) => ({
    name: p.name,
    phone: p.phone!,
    text: `${body}\n\n${pickCta("generic")}\n\n${appLinkFooter()}`,
  }));
  const { sent, failed } = await deliver(recipients);
  return { total: participants.length, sent, failed, skipped: 0 };
}
