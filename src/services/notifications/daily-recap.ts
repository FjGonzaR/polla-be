import { MatchStatus, RoundSlug } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { sendWhatsappMessage } from "../../lib/whatsapp.client.js";
import { appLinkFooter, pickCta, type BroadcastResultDto } from "./shared.js";

const DAY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
// Colombia (America/Bogota) is UTC-5 year-round (no DST), so 00:00 local = 05:00 UTC.
const BOGOTA_UTC_OFFSET_HOURS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

interface DayWindow {
  start: Date;
  end: Date;
  dateKey: string; // YYYY-MM-DD (Bogota) — used both as label source and dedup key
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Bogota calendar-date parts (year/month/day) for a given instant.
function bogotaParts(instant: Date): { y: number; m: number; d: number } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const [y, m, d] = formatted.split("-").map(Number);
  return { y, m, d };
}

function windowFromParts(y: number, m: number, d: number): DayWindow {
  const start = new Date(Date.UTC(y, m - 1, d, BOGOTA_UTC_OFFSET_HOURS, 0, 0));
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end, dateKey: `${y}-${pad(m)}-${pad(d)}` };
}

// Resolves the Bogota calendar day to recap. With an explicit `day` string
// (YYYY-MM-DD) it recaps that day; otherwise it defaults to yesterday.
function resolveDayWindow(day?: string): DayWindow {
  if (day) {
    const match = DAY_REGEX.exec(day.trim());
    if (!match)
      throw new AppError(400, "INVALID_DAY", "day must be formatted as YYYY-MM-DD");
    const [, y, m, d] = match;
    const window = windowFromParts(Number(y), Number(m), Number(d));
    // Reject nonsense dates that JS silently rolls over (e.g. 2026-02-31): the
    // window start is at 05:00 UTC of that Bogota day, so its UTC calendar parts
    // must match the input exactly.
    if (
      window.start.getUTCFullYear() !== Number(y) ||
      window.start.getUTCMonth() !== Number(m) - 1 ||
      window.start.getUTCDate() !== Number(d)
    )
      throw new AppError(400, "INVALID_DAY", "day is not a valid calendar date");
    return window;
  }
  const { y, m, d } = bogotaParts(new Date(Date.now() - DAY_MS));
  return windowFromParts(y, m, d);
}

// Validates an optional `day` string (YYYY-MM-DD) without doing any work, so the
// broadcast route can reject a bad day synchronously (400) before backgrounding.
export function assertValidDay(day?: string): void {
  resolveDayWindow(day);
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

function formatPoints(points: number): string {
  return `${points > 0 ? "+" : ""}${points} pts`;
}

type KoMatch = Awaited<ReturnType<typeof fetchKoMatches>>[number];

async function fetchKoMatches(start: Date, end: Date) {
  return prisma.match.findMany({
    where: {
      status: MatchStatus.FINISHED,
      scheduledAt: { gte: start, lt: end },
      round: { slug: { not: RoundSlug.GROUP } },
    },
    include: { homeTeam: true, awayTeam: true },
  });
}

function emptyResult(): BroadcastResultDto {
  return { total: 0, sent: 0, failed: 0, skipped: 0 };
}

// Builds the WhatsApp recap for one participant: the day's KO results with the
// points they earned per match, plus powerup lines when their promesa/decepción
// team played that day.
function buildRecapMessage(
  dateKey: string,
  matches: KoMatch[],
  pointsByMatch: Map<string, number>,
  powerup: { darkHorseTeamId: string; disappointmentTeamId: string } | undefined,
  teamsPlayed: Map<string, { name: string; match: KoMatch }>,
): string {
  const matchLines = matches.map((match) => {
    const home = match.homeTeam?.name ?? "TBD";
    const away = match.awayTeam?.name ?? "TBD";
    const pts = pointsByMatch.get(match.id) ?? 0;
    return `• *${home} ${match.scoreHome}-${match.scoreAway} ${away}* → ${formatPoints(pts)}`;
  });

  const total = matches.reduce((sum, m) => sum + (pointsByMatch.get(m.id) ?? 0), 0);

  const powerupLines: string[] = [];
  if (powerup) {
    const darkHorse = teamsPlayed.get(powerup.darkHorseTeamId);
    if (darkHorse && darkHorse.match.winnerTeamId) {
      powerupLines.push(
        darkHorse.match.winnerTeamId === powerup.darkHorseTeamId
          ? `🐎 Tu promesa *${darkHorse.name}* ganó y avanza. ¡Sigue viva!`
          : `🐎💀 Tu promesa *${darkHorse.name}* quedó eliminada. Se acabó el sueño.`,
      );
    }
    const disappointment = teamsPlayed.get(powerup.disappointmentTeamId);
    if (disappointment && disappointment.match.winnerTeamId) {
      powerupLines.push(
        disappointment.match.winnerTeamId === powerup.disappointmentTeamId
          ? `😈 Tu decepción *${disappointment.name}* avanzó... te resta puntos esta ronda.`
          : `😌 Tu decepción *${disappointment.name}* quedó eliminada. ¡Justo lo que querías!`,
      );
    }
  }

  const parts = [
    `🐙 *PaulPredice* — Resumen del día`,
    ``,
    `⚽ *Polla Mundial 2026*`,
    `Resultados (${formatDayLabel(dateKey)}):`,
    ...matchLines,
    ``,
    `Total: *${formatPoints(total)}*`,
  ];
  if (powerupLines.length > 0) parts.push(``, ...powerupLines);
  parts.push(``, pickCta("dailyRecap"), ``, appLinkFooter());
  return parts.join("\n");
}

export async function broadcastDailyRecap(
  day?: string,
  participantIds?: string[],
): Promise<BroadcastResultDto> {
  const { start, end, dateKey } = resolveDayWindow(day);

  const matches = await fetchKoMatches(start, end);
  if (matches.length === 0) return emptyResult();

  const matchIds = matches.map((m) => m.id);

  // Teams that played that day → used to detect powerup involvement + outcome.
  const teamsPlayed = new Map<string, { name: string; match: KoMatch }>();
  for (const match of matches) {
    if (match.homeTeamId && match.homeTeam)
      teamsPlayed.set(match.homeTeamId, { name: match.homeTeam.name, match });
    if (match.awayTeamId && match.awayTeam)
      teamsPlayed.set(match.awayTeamId, { name: match.awayTeam.name, match });
  }
  const playedTeamIds = [...teamsPlayed.keys()];

  const restrictIds =
    participantIds && participantIds.length > 0 ? new Set(participantIds) : null;

  // Involved = has a KO prediction on one of these matches, OR their powerup
  // team played that day.
  const [koPredictions, powerups] = await Promise.all([
    prisma.koPrediction.findMany({
      where: { matchId: { in: matchIds } },
      select: { participantId: true },
    }),
    prisma.powerup.findMany({
      where: {
        OR: [
          { darkHorseTeamId: { in: playedTeamIds } },
          { disappointmentTeamId: { in: playedTeamIds } },
        ],
      },
    }),
  ]);

  const involvedIds = new Set<string>();
  for (const p of koPredictions) involvedIds.add(p.participantId);
  for (const p of powerups) involvedIds.add(p.participantId);

  const targetIds = [...involvedIds].filter((id) => !restrictIds || restrictIds.has(id));
  if (targetIds.length === 0) return emptyResult();

  const [participants, scoreEvents, alreadySent] = await Promise.all([
    prisma.participant.findMany({
      where: { id: { in: targetIds }, hasPhone: true, phone: { not: null } },
      select: { id: true, name: true, phone: true },
    }),
    prisma.scoreEvent.findMany({
      where: { matchId: { in: matchIds }, participantId: { in: targetIds } },
      select: { participantId: true, matchId: true, points: true },
    }),
    prisma.notification.findMany({
      where: { type: "DAILY_RECAP", dedupKey: dateKey, participantId: { in: targetIds } },
      select: { participantId: true },
    }),
  ]);

  const powerupByParticipant = new Map(powerups.map((p) => [p.participantId, p]));
  const sentIds = new Set(alreadySent.map((n) => n.participantId));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const participant of participants) {
    if (sentIds.has(participant.id)) {
      skipped++;
      continue;
    }

    const pointsByMatch = new Map<string, number>();
    for (const event of scoreEvents) {
      if (event.participantId !== participant.id || !event.matchId) continue;
      pointsByMatch.set(
        event.matchId,
        (pointsByMatch.get(event.matchId) ?? 0) + event.points,
      );
    }

    const message = buildRecapMessage(
      dateKey,
      matches,
      pointsByMatch,
      powerupByParticipant.get(participant.id),
      teamsPlayed,
    );

    try {
      await sendWhatsappMessage(participant.phone!, message);
      await prisma.notification.create({
        data: { participantId: participant.id, type: "DAILY_RECAP", dedupKey: dateKey },
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[daily-recap] Failed for ${participant.name}:`,
        (err as Error).message,
      );
    }
  }

  return { total: participants.length, sent, failed, skipped };
}
