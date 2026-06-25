import type { Prisma } from "@prisma/client";
import { sendWhatsappMessage } from "../../lib/whatsapp.client.js";

export const APP_URL = process.env.APP_URL ?? "https://app.paulpredice.com";
// URL alone on its own line so WhatsApp auto-detects it as a clickable link
// (an adjacent emoji/char before the URL breaks link detection).
export const appLinkFooter = (): string => APP_URL;

// Recipients = participants with a phone, optionally narrowed to an explicit id list.
export function recipientWhere(
  participantIds?: string[],
): Prisma.ParticipantWhereInput {
  return {
    hasPhone: true,
    phone: { not: null },
    ...(participantIds && participantIds.length > 0
      ? { id: { in: participantIds } }
      : {}),
  };
}

export const NOTIFICATION_TYPES = [
  "GROUP_PHASE_LAST_ROUND_REMINDER",
  "GENERIC",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface BroadcastResultDto {
  total: number; // participants targeted (with phone)
  sent: number;
  failed: number; // sendWhatsappMessage threw
  skipped: number; // service chose not to send (e.g. missing position)
}

export interface Recipient {
  name: string;
  phone: string;
  text: string;
}

// Shared delivery loop: sends each precomputed message, never throws, returns counts.
export async function deliver(
  recipients: Recipient[],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await sendWhatsappMessage(r.phone, r.text);
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[notification] Failed for ${r.name}:`,
        (err as Error).message,
      );
    }
  }
  return { sent, failed };
}
