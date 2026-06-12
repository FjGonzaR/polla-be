import { prisma } from '../lib/prisma.js'

function toPct(count: number, total: number): number {
  return parseFloat(((count / total) * 100).toFixed(2))
}

/**
 * Aggregates the crowd's KO predictions for a single match and persists a
 * MatchPredictionStat row. Called when a match is detected as started (LIVE)
 * or finished. Idempotent: if a row already exists it does nothing, so the
 * repeated cron passes stay cheap (predictions lock 30 min before kickoff, so
 * the snapshot is final the moment the match starts).
 */
export async function computeAndPersistMatchStats(matchId: string): Promise<void> {
  const existing = await prisma.matchPredictionStat.findUnique({ where: { matchId } })
  if (existing) return

  const predictions = await prisma.koPrediction.findMany({
    where: { matchId },
    select: { scoreHome: true, scoreAway: true, tripleActive: true },
  })

  const total = predictions.length

  if (total === 0) {
    await prisma.matchPredictionStat.create({
      data: {
        matchId,
        totalPredictions: 0,
        pctHomeWin: 0,
        pctDraw: 0,
        pctAwayWin: 0,
        pctTripleActive: 0,
        topScoreHome: null,
        topScoreAway: null,
        topScorePct: 0,
      },
    })
    return
  }

  let homeWin = 0
  let draw = 0
  let awayWin = 0
  let triple = 0
  const scorelineCounts = new Map<string, number>()

  for (const p of predictions) {
    if (p.scoreHome > p.scoreAway) homeWin++
    else if (p.scoreHome === p.scoreAway) draw++
    else awayWin++

    if (p.tripleActive) triple++

    const key = `${p.scoreHome}-${p.scoreAway}`
    scorelineCounts.set(key, (scorelineCounts.get(key) ?? 0) + 1)
  }

  let topKey: string | null = null
  let topCount = 0
  for (const [key, count] of scorelineCounts) {
    if (count > topCount) {
      topCount = count
      topKey = key
    }
  }

  const [topHome, topAway] = topKey ? topKey.split('-').map(Number) : [null, null]

  await prisma.matchPredictionStat.create({
    data: {
      matchId,
      totalPredictions: total,
      pctHomeWin: toPct(homeWin, total),
      pctDraw: toPct(draw, total),
      pctAwayWin: toPct(awayWin, total),
      pctTripleActive: toPct(triple, total),
      topScoreHome: topHome,
      topScoreAway: topAway,
      topScorePct: toPct(topCount, total),
    },
  })
}
