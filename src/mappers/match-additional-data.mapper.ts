import type { Prisma } from '@prisma/client'

export interface ScorerDto {
  player: string
  minute: number | null
  stoppage: number | null
  ownGoal: boolean
  penalty: boolean
  display: string
}

export interface AdditionalDataDto {
  homeScorers: ScorerDto[]
  awayScorers: ScorerDto[]
  stadiumName: string | null
  stadiumCity: string | null
  stadiumCountry: string | null
  stadiumCapacity: number | null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

// "<player> <minute>'[+<stoppage>']?[(<marker>)]?"
const SCORER_REGEX = /^(.*?)\s+(\d+)'(?:\+(\d+)')?(?:\s*\(([^)]+)\))?$/

// Splits the external API's Postgres-array literal of scorers into raw elements.
function splitScorerElements(raw: string): string[] {
  let s = raw.trim()
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1)

  const quoted = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
  if (quoted.length > 0) return quoted

  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function parseScorerElement(element: string): ScorerDto {
  const trimmed = element.trim()
  const match = SCORER_REGEX.exec(trimmed)

  if (!match) {
    return { player: trimmed, minute: null, stoppage: null, ownGoal: false, penalty: false, display: trimmed }
  }

  const [, player, minuteStr, stoppageStr, marker] = match
  const minute = parseInt(minuteStr, 10)
  const stoppage = stoppageStr != null ? parseInt(stoppageStr, 10) : null
  const ownGoal = marker != null && marker.toUpperCase() === 'OG'
  const penalty = marker != null && /^P/i.test(marker)

  let display = `${minute}'`
  if (stoppage != null) display += `+${stoppage}'`
  if (marker != null) display += ` (${marker})`

  return { player: player.trim(), minute, stoppage, ownGoal, penalty, display }
}

/**
 * Parses the external API's scorers field (a Postgres-array literal string such as
 * `{"F. Balogun 45'+5'","D. Bobadilla 7'(OG)"}`) into structured scorers. Returns [] for
 * null / "null" / empty input.
 */
export function parseScorersField(raw: string | null | undefined): ScorerDto[] {
  if (raw == null) return []
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === 'null') return []

  return splitScorerElements(trimmed).map(parseScorerElement)
}

/**
 * Maps a match's additionalData JSON (scorers + stadium info) to a typed DTO.
 * Returns null when there is no object payload.
 */
export function toAdditionalDataDto(
  value: Prisma.JsonValue | null | undefined,
): AdditionalDataDto | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  return {
    homeScorers: parseScorersField(str(data.homeScorers)),
    awayScorers: parseScorersField(str(data.awayScorers)),
    stadiumName: str(data.stadiumName),
    stadiumCity: str(data.stadiumCity),
    stadiumCountry: str(data.stadiumCountry),
    stadiumCapacity: num(data.stadiumCapacity),
  }
}
