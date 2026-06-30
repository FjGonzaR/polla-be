import type { Prisma } from '@prisma/client'
import type { WorldCupMatch } from '../types/worldcup-api.types.js'

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function parsePenaltyScore(value: string | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Merges the latest scorers and penalty shootout scores from the external API
 * into a match's additionalData, preserving any existing keys (e.g. stadium
 * fields loaded by the admin). Penalty scores are only present for KO matches
 * decided from the spot.
 */
export function withUpdatedScorers(
  existing: Prisma.JsonValue | null | undefined,
  match: WorldCupMatch,
): Prisma.InputJsonObject {
  return {
    ...(asObject(existing) as Prisma.InputJsonObject),
    homeScorers: match.home_scorers ?? null,
    awayScorers: match.away_scorers ?? null,
    homePenaltyScore: parsePenaltyScore(match.home_penalty_score),
    awayPenaltyScore: parsePenaltyScore(match.away_penalty_score),
  }
}
