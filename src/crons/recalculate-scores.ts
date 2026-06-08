import { recalculateAllScores } from '../services/score-calculation.service.js'

export async function recalculateScores(): Promise<void> {
  console.info('[recalculate-scores] Starting score recalculation...')
  try {
    const { participants, events } = await recalculateAllScores()
    console.info(`[recalculate-scores] OK — ${participants} participants, ${events} events written`)
  } catch (error) {
    console.error('[recalculate-scores] Error during recalculation:', (error as Error).message)
  }
}
