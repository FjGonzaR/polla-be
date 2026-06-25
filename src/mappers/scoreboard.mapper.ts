export interface ScoreboardEntryDto {
  rank: number
  participant: { id: string; name: string }
  total: number
  realTotal: number
  simulatedTotal: number
  prize: number | null
}

export interface ScoreBreakdownBuckets {
  groups: number
  thirds: number
  ko: number
  darkHorse: number
  disappointment: number
}

export interface ScoreBreakdownDto {
  participant: { id: string; name: string }
  total: number
  realTotal: number
  simulatedTotal: number
  breakdown: ScoreBreakdownBuckets
  realBreakdown: ScoreBreakdownBuckets
  simulatedBreakdown: ScoreBreakdownBuckets
  tripleUsesRemaining: number
  prize: number | null
}

const PRIZES: Record<number, number> = { 1: 800000, 2: 300000, 3: 100000 }

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
const DARK_HORSE_PARAM_KEYS = ['pts_dark_horse_per_round', 'pts_dark_horse_group']
const DISAPPOINTMENT_PARAM_KEYS = ['pts_disappointment_per_round', 'pts_disappointment_group']

export function toScoreboardEntryDto(
  rank: number,
  tieGroupSize: number,
  participant: { id: string; name: string },
  realTotal: number,
  simulatedTotal: number,
): ScoreboardEntryDto {
  return {
    rank,
    participant,
    total: realTotal + simulatedTotal,
    realTotal,
    simulatedTotal,
    prize: computeSharedPrize(rank, tieGroupSize),
  }
}

export interface ProvisionalBreakdown {
  groups: number
  ko: number
  darkHorse: number
  disappointment: number
}

export function toScoreBreakdownDto(
  participant: { id: string; name: string },
  events: { paramKey: string; points: number }[],
  tripleUsesRemaining: number,
  prize: number | null,
  provisional: ProvisionalBreakdown = { groups: 0, ko: 0, darkHorse: 0, disappointment: 0 },
): ScoreBreakdownDto {
  const sum = (keys: string[]) =>
    events.filter((e) => keys.includes(e.paramKey)).reduce((acc, e) => acc + e.points, 0)

  const realBreakdown: ScoreBreakdownBuckets = {
    groups: sum(GROUP_PARAM_KEYS),
    thirds: sum(THIRD_PARAM_KEYS),
    ko: sum(KO_PARAM_KEYS),
    darkHorse: sum(DARK_HORSE_PARAM_KEYS),
    disappointment: sum(DISAPPOINTMENT_PARAM_KEYS),
  }
  const simulatedBreakdown: ScoreBreakdownBuckets = {
    groups: provisional.groups,
    thirds: 0,
    ko: provisional.ko,
    darkHorse: provisional.darkHorse,
    disappointment: provisional.disappointment,
  }
  const breakdown: ScoreBreakdownBuckets = {
    groups: realBreakdown.groups + simulatedBreakdown.groups,
    thirds: realBreakdown.thirds + simulatedBreakdown.thirds,
    ko: realBreakdown.ko + simulatedBreakdown.ko,
    darkHorse: realBreakdown.darkHorse + simulatedBreakdown.darkHorse,
    disappointment: realBreakdown.disappointment + simulatedBreakdown.disappointment,
  }

  const sumBuckets = (b: ScoreBreakdownBuckets) =>
    b.groups + b.thirds + b.ko + b.darkHorse + b.disappointment
  const realTotal = sumBuckets(realBreakdown)
  const simulatedTotal = sumBuckets(simulatedBreakdown)

  return {
    participant,
    total: realTotal + simulatedTotal,
    realTotal,
    simulatedTotal,
    breakdown,
    realBreakdown,
    simulatedBreakdown,
    tripleUsesRemaining,
    prize,
  }
}
