export interface ScoreboardEntryDto {
  rank: number
  participant: { id: string; name: string }
  total: number
  prize: number | null
}

export interface ScoreBreakdownDto {
  participant: { id: string; name: string }
  total: number
  breakdown: {
    groups: number
    thirds: number
    ko: number
    darkHorse: number
    disappointment: number
  }
  tripleUsesRemaining: number
  prize: number | null
}

const PRIZES: Record<number, number> = { 1: 700000, 2: 250000, 3: 50000 }

function computeSharedPrize(rank: number, groupSize: number): number | null {
  let sum = 0
  for (let i = 0; i < groupSize; i++) {
    sum += PRIZES[rank + i] ?? 0
  }
  return sum > 0 ? Math.round(sum / groupSize) : null
}

const GROUP_PARAM_KEYS = ['pts_group_position_exact', 'bonus_group_complete']
const THIRD_PARAM_KEYS = ['pts_third_correct']
const KO_PARAM_KEYS = ['pts_ko_advances', 'pts_ko_exact_score', 'mult_triple']
const DARK_HORSE_PARAM_KEYS = ['pts_dark_horse_per_round']
const DISAPPOINTMENT_PARAM_KEYS = ['pts_disappointment_per_round']

export function toScoreboardEntryDto(
  rank: number,
  tieGroupSize: number,
  participant: { id: string; name: string },
  total: number,
): ScoreboardEntryDto {
  return {
    rank,
    participant,
    total,
    prize: computeSharedPrize(rank, tieGroupSize),
  }
}

export function toScoreBreakdownDto(
  participant: { id: string; name: string },
  events: { paramKey: string; points: number }[],
  tripleUsesRemaining: number,
  prize: number | null,
): ScoreBreakdownDto {
  const sum = (keys: string[]) =>
    events.filter((e) => keys.includes(e.paramKey)).reduce((acc, e) => acc + e.points, 0)

  const groups = sum(GROUP_PARAM_KEYS)
  const thirds = sum(THIRD_PARAM_KEYS)
  const ko = sum(KO_PARAM_KEYS)
  const darkHorse = sum(DARK_HORSE_PARAM_KEYS)
  const disappointment = sum(DISAPPOINTMENT_PARAM_KEYS)

  return {
    participant,
    total: groups + thirds + ko + darkHorse + disappointment,
    breakdown: { groups, thirds, ko, darkHorse, disappointment },
    tripleUsesRemaining,
    prize,
  }
}
