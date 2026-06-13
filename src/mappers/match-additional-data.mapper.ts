import type { Prisma } from '@prisma/client'

export interface AdditionalDataDto {
  homeScorers: string | null
  awayScorers: string | null
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
    homeScorers: str(data.homeScorers),
    awayScorers: str(data.awayScorers),
    stadiumName: str(data.stadiumName),
    stadiumCity: str(data.stadiumCity),
    stadiumCountry: str(data.stadiumCountry),
    stadiumCapacity: num(data.stadiumCapacity),
  }
}
