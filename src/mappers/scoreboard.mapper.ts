export interface ScoreboardEntryDto {
  rank: number
  participant: { id: string; name: string }
  totalPoints: number
  exactKoScores: number
  prize: number | null
}

const PRIZES: Record<number, number> = { 1: 700000, 2: 250000, 3: 50000 }

export function toScoreboardEntryDto(
  rank: number,
  participant: { id: string; name: string },
  totalPoints: number,
  exactKoScores: number,
): ScoreboardEntryDto {
  return {
    rank,
    participant,
    totalPoints,
    exactKoScores,
    prize: PRIZES[rank] ?? null,
  }
}
