import type { Prisma } from '@prisma/client'
import type { WorldCupMatch } from '../types/worldcup-api.types.js'

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Merges the latest scorers from the external API into a match's additionalData,
 * preserving any existing keys (e.g. stadium fields loaded by the admin).
 */
export function withUpdatedScorers(
  existing: Prisma.JsonValue | null | undefined,
  match: WorldCupMatch,
): Prisma.InputJsonObject {
  return {
    ...(asObject(existing) as Prisma.InputJsonObject),
    homeScorers: match.home_scorers ?? null,
    awayScorers: match.away_scorers ?? null,
  }
}
