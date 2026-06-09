import { InvitationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  toInvitationDto,
  type InvitationDto,
} from "../mappers/invitation.mapper.js";
import { sendWhatsappMessage } from "../lib/whatsapp.client.js";

function generateCode(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < 4; i++)
    code += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++)
    code += digits[Math.floor(Math.random() * digits.length)];
  return code;
}

export async function createInvitation(phone?: string): Promise<InvitationDto> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const code = generateCode();
  const inv = await prisma.invitation.create({
    data: { code, expiresAt, phone: phone ?? null },
  });

  if (phone) {
    const appUrl = process.env.APP_URL ?? "https://paulpredice.com";
    const msg =
      `🐙 *¡Hola! Soy Paul, el pulpo oráculo de PaulPredice.* 🔮\n\n` +
      `Mis tentáculos me dicen que sabes de fútbol, por eso te han invitado a mi Polla del Mundial 2026 🏆\n\n` +
      `🔑 Tu código de acceso: *${code}*\n` +
      `👉 Regístrate conmigo aquí: ${appUrl}\n\n` +
      `⏳ ¡No me dejes plantado! Tienes solo 24 horas para activar este código antes de que expire. ¡Ven a demostrar tu instinto!`;
    sendWhatsappMessage(phone, msg).catch((err: Error) =>
      console.warn("[invitation] WhatsApp send failed:", err.message),
    );
  }

  return toInvitationDto(inv);
}

const DEFAULT_PAGE_SIZE = 20;

export async function listInvitations(
  status?: InvitationStatus,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<{
  data: InvitationDto[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where = status ? { status } : undefined;
  const [rows, total] = await prisma.$transaction([
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { data: rows.map(toInvitationDto), total, page, pageSize };
}
