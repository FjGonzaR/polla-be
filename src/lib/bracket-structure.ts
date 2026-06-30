import type { SourceOutcome } from '@prisma/client'

export interface BracketSource {
  matchNumber: number
  outcome: SourceOutcome
}

export interface BracketFeeders {
  home: BracketSource
  away: BracketSource
}

/**
 * Static World Cup 2026 knockout bracket. Maps each KO match (by matchNumber)
 * to the two matches whose winner/loser fill its home and away slots.
 *
 * The bracket tree is fixed and published by FIFA — it does not depend on which
 * teams qualify — so it is hardcoded here rather than parsed from the external
 * API labels (e.g. "Winner Match 74"), which are brittle to format changes.
 *
 * R32 matches (73-88) are fed by groups, not other matches, so they are absent
 * from this map (their slots use homeTeamLabel / awayTeamLabel instead).
 * The third-place match (103) is fed by the LOSERS of the two semifinals.
 */
export const BRACKET_FEEDERS: Record<number, BracketFeeders> = {
  // R16
  89: { home: { matchNumber: 74, outcome: 'WINNER' }, away: { matchNumber: 77, outcome: 'WINNER' } },
  90: { home: { matchNumber: 73, outcome: 'WINNER' }, away: { matchNumber: 75, outcome: 'WINNER' } },
  91: { home: { matchNumber: 76, outcome: 'WINNER' }, away: { matchNumber: 78, outcome: 'WINNER' } },
  92: { home: { matchNumber: 79, outcome: 'WINNER' }, away: { matchNumber: 80, outcome: 'WINNER' } },
  93: { home: { matchNumber: 83, outcome: 'WINNER' }, away: { matchNumber: 84, outcome: 'WINNER' } },
  94: { home: { matchNumber: 81, outcome: 'WINNER' }, away: { matchNumber: 82, outcome: 'WINNER' } },
  95: { home: { matchNumber: 86, outcome: 'WINNER' }, away: { matchNumber: 88, outcome: 'WINNER' } },
  96: { home: { matchNumber: 85, outcome: 'WINNER' }, away: { matchNumber: 87, outcome: 'WINNER' } },
  // QF
  97: { home: { matchNumber: 89, outcome: 'WINNER' }, away: { matchNumber: 90, outcome: 'WINNER' } },
  98: { home: { matchNumber: 93, outcome: 'WINNER' }, away: { matchNumber: 94, outcome: 'WINNER' } },
  99: { home: { matchNumber: 91, outcome: 'WINNER' }, away: { matchNumber: 92, outcome: 'WINNER' } },
  100: { home: { matchNumber: 95, outcome: 'WINNER' }, away: { matchNumber: 96, outcome: 'WINNER' } },
  // SF
  101: { home: { matchNumber: 97, outcome: 'WINNER' }, away: { matchNumber: 98, outcome: 'WINNER' } },
  102: { home: { matchNumber: 99, outcome: 'WINNER' }, away: { matchNumber: 100, outcome: 'WINNER' } },
  // Third place — losers of the semifinals
  103: { home: { matchNumber: 101, outcome: 'LOSER' }, away: { matchNumber: 102, outcome: 'LOSER' } },
  // Final
  104: { home: { matchNumber: 101, outcome: 'WINNER' }, away: { matchNumber: 102, outcome: 'WINNER' } },
}
