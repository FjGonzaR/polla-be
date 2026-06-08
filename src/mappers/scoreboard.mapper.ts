export interface ScoreboardEntryDto {
  rank: number
  participant: { id: string; name: string }
  totalPoints: number
  exactKoScores: number
  prize: number | null
}

export interface ScoreBreakdownDto {
  participant: { id: string; name: string }
  groups: number
  thirds: number
  ko: number
  darkHorse: number
  disappointment: number
  total: number
  tripleUsesRemaining: number
}

const PRIZES: Record<number, number> = { 1: 700000, 2: 250000, 3: 50000 }

const GROUP_PARAM_KEYS = ['pts_group_position_exact', 'bonus_group_complete']
const THIRD_PARAM_KEYS = ['pts_third_correct']
const KO_PARAM_KEYS = ['pts_ko_advances', 'pts_ko_exact_score', 'mult_triple']
const DARK_HORSE_PARAM_KEYS = ['pts_dark_horse_per_round']
const DISAPPOINTMENT_PARAM_KEYS = ['pts_disappointment_per_round']

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

export function toScoreBreakdownDto(
  participant: { id: string; name: string },
  events: { paramKey: string; points: number }[],
  tripleUsesRemaining: number,
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
    groups,
    thirds,
    ko,
    darkHorse,
    disappointment,
    total: groups + thirds + ko + darkHorse + disappointment,
    tripleUsesRemaining,
  }
}
