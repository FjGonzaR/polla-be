import type { Prisma } from "@prisma/client";
import { sendWhatsappMessage } from "../../lib/whatsapp.client.js";

export const APP_URL = process.env.APP_URL ?? "https://app.paulpredice.com";
// URL alone on its own line so WhatsApp auto-detects it as a clickable link
// (an adjacent emoji/char before the URL breaks link detection).
export const appLinkFooter = (): string => APP_URL;

// --- Call to action ----------------------------------------------------------
// A short prompt appended to notifications to invite a TEXT reply. Beyond
// engagement, replies create two-way conversation, which is the strongest signal
// for keeping the sender number's delivery reputation healthy. Text only, no
// reactions (they don't count the same). Picked per-message so CTAs vary across
// recipients within a single broadcast (avoids the identical-message spam signal).
export type CtaType =
  | "matchReminder"
  | "dailyRecap"
  | "standings"
  | "groupPhase"
  | "powerup"
  | "generic";

const CTA_GENERIC = [
  "💬 Respóndenos qué opinas de la jornada",
  "⚽ Escríbenos tu pronóstico para hoy",
  "🎯 Cuéntanos con qué selección vas",
  "🔥 Mándanos tu favorito del día",
];

const CTA_BY_TYPE: Record<Exclude<CtaType, "generic">, string[]> = {
  matchReminder: [
    "⚽ Respóndenos: ¿quién crees que marca hoy?",
    "🔮 Escríbenos tu resultado exacto para este partido",
    "💬 ¿Quién gana y por cuánto? Mándanos tu pronóstico",
    "🧠 Respóndenos qué selección pasa de ronda",
    "🎯 Cuéntanos: ¿habrá sorpresa en este partido?",
  ],
  dailyRecap: [
    "🤔 ¿Qué equipo te sorprendió? Cuéntanos",
    "🔥 Respóndenos quién fue tu jugador del día",
    "💬 ¿Cómo te fue? Escríbenos tu reacción a la jornada",
    "🎯 ¿Quién la romperá hoy? Mándanos tu favorito",
    "😅 Respóndenos: ¿remontas o te hundes mañana?",
  ],
  standings: [
    "📈 ¿Vas a escalar posiciones? Respóndenos tu meta",
    "💬 Cuéntanos: ¿a quién quieres alcanzar en la tabla?",
    "🔥 Escríbenos si crees que llegas al podio",
    "🎯 ¿Confiado o preocupado con tu puesto? Respóndenos",
  ],
  groupPhase: [
    "💬 ¿Dudas con tus predicciones? Respóndenos y te ayudamos",
    "🏆 Escríbenos cuál es tu candidato a campeón",
    "🎯 Cuéntanos qué selección te da más confianza",
    "🤔 Respóndenos: ¿cuál es tu caballo negro del torneo?",
  ],
  powerup: [
    "💬 ¿Te salió el caballo negro? Cuéntanos",
    "🔥 Respóndenos: ¿confías en tu promesa para la fase KO?",
    "🎯 Escríbenos hasta dónde crees que llega tu equipo",
  ],
};

export function pickCta(type: CtaType = "generic"): string {
  const pool = type === "generic" ? CTA_GENERIC : CTA_BY_TYPE[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

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
  "DAILY_RECAP",
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
