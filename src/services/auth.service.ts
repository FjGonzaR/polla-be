import { InvitationStatus, ParticipantRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyGoogleToken } from "../lib/google-auth.js";
import { AppError } from "../lib/errors.js";
import { ADMIN_PHONES } from "../lib/admins.js";
import { sendWhatsappMessage } from "../lib/whatsapp.client.js";

export async function loginOrSignup(
  credential: string,
  code?: string,
  phone?: string,
) {
  let googlePayload;
  try {
    googlePayload = await verifyGoogleToken(credential);
  } catch {
    throw new AppError(
      401,
      "INVALID_CREDENTIAL",
      "Credential de Google inválido o expirado",
    );
  }

  const existing = await prisma.participant.findUnique({
    where: { googleId: googlePayload.sub },
  });

  if (existing) return existing;

  if (phone && ADMIN_PHONES.includes(phone)) {
    return prisma.participant.create({
      data: {
        googleId: googlePayload.sub,
        name: googlePayload.name ?? "Admin",
        email: googlePayload.email ?? "",
        phone,
        hasPhone: true,
        role: ParticipantRole.ADMIN,
      },
    });
  }

  if (!code || !phone) {
    throw new AppError(
      403,
      "NEEDS_SIGNUP",
      "Needs an invitation code to register",
    );
  }

  const e164 = /^\+[1-9]\d{7,14}$/;
  if (!e164.test(phone)) {
    throw new AppError(
      400,
      "INVALID_PHONE",
      "Formato inválido. Usa E.164, ej: +573001234567",
    );
  }

  const invitation = await prisma.invitation.findUnique({ where: { code } });
  if (!invitation) {
    throw new AppError(
      404,
      "INVITE_NOT_FOUND",
      "Código de invitación no encontrado",
    );
  }
  if (invitation.status !== InvitationStatus.AVAILABLE) {
    throw new AppError(
      409,
      "INVITE_USED_OR_EXPIRED",
      "Código ya utilizado o expirado",
    );
  }
  if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new AppError(409, "INVITE_EXPIRED", "Código expirado");
  }

  try {
    const [, participant] = await prisma.$transaction([
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.USED, usedAt: new Date() },
      }),
      prisma.participant.create({
        data: {
          googleId: googlePayload.sub,
          name: googlePayload.name,
          email: googlePayload.email,
          phone,
          hasPhone: true,
          role: ParticipantRole.PARTICIPANT,
          invitationId: invitation.id,
        },
      }),
    ]);

    const appUrl = process.env.APP_URL ?? "https://app.paulpredice.com";
    const welcomeMsg =
      `🐙 ¡Ya eres parte de PaulPredice! 🏆\n\n` +
      `Tu registro ha sido un éxito. Entra aquí para empezar:\n${appUrl}\n\n` +
      `🗓️ *Fecha límite:* 11 de junio (Primer partido del Mundial).\n` +
      `🔒 *Qué se cierra:* Predicciones de grupos, terceros y la configuración de tus poderes.\n\n` +
      `No lo dejes para el final. ¡Pon a prueba tu instinto y buena suerte en la Polla! ⚽`;
    sendWhatsappMessage(phone, welcomeMsg).catch((err: Error) =>
      console.warn("[auth] Welcome WhatsApp send failed:", err.message),
    );

    return participant;
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === "P2002") {
      throw new AppError(
        409,
        "ALREADY_REGISTERED",
        "Ya existe un participante con este Google ID",
      );
    }
    throw err;
  }
}
