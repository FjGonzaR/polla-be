import { describe, it, expect } from 'vitest'
import { createPacedQueue } from '../../lib/paced-queue.js'

// A virtual clock makes pacing deterministic and instant: `now` reads it and
// `sleep` advances it, so no real timers are involved. Start above 0 because the
// queue uses lastSentAt === 0 as the "nothing sent yet" sentinel.
function virtualClock(start = 10_000) {
  let clock = start
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
    get value() {
      return clock
    },
  }
}

describe('createPacedQueue', () => {
  it('paces sequentially-awaited sends by delayMs (the regression that caused the ban)', async () => {
    // Callers (crons, broadcasts) await each send one at a time, so the queue
    // only ever holds a single item. The old logic skipped its delay in exactly
    // this case; this asserts the delay is now applied regardless.
    const c = virtualClock()
    const sendTimes: number[] = []
    const queue = createPacedQueue({
      send: async () => {
        sendTimes.push(c.now())
      },
      delayMs: 1000,
      jitterMs: 0,
      batchSize: 0,
      batchPauseMs: 0,
      now: c.now,
      sleep: c.sleep,
    })

    for (let i = 0; i < 4; i++) await queue.enqueue('+1', 'hi')

    expect(sendTimes).toEqual([10_000, 11_000, 12_000, 13_000])
  })

  it('does not delay the very first send', async () => {
    const c = virtualClock()
    const sendTimes: number[] = []
    const queue = createPacedQueue({
      send: async () => {
        sendTimes.push(c.now())
      },
      delayMs: 5000,
      jitterMs: 0,
      batchSize: 0,
      batchPauseMs: 0,
      now: c.now,
      sleep: c.sleep,
    })

    await queue.enqueue('+1', 'hi')

    expect(sendTimes).toEqual([10_000])
  })

  it('takes a batch pause after batchSize sends', async () => {
    const c = virtualClock()
    const sendTimes: number[] = []
    let batchPauses = 0
    const queue = createPacedQueue({
      send: async () => {
        sendTimes.push(c.now())
      },
      delayMs: 1000,
      jitterMs: 0,
      batchSize: 3,
      batchPauseMs: 60_000,
      onBatchPause: () => {
        batchPauses++
      },
      now: c.now,
      sleep: c.sleep,
    })

    for (let i = 0; i < 5; i++) await queue.enqueue('+1', 'hi')

    // 3 sends spaced by 1000, then the 4th waits the 60s batch pause, then 1000 again.
    expect(sendTimes).toEqual([10_000, 11_000, 12_000, 72_000, 73_000])
    expect(batchPauses).toBe(1)
  })

  it('serializes concurrent enqueues without interleaving sends', async () => {
    const c = virtualClock()
    const events: string[] = []
    const queue = createPacedQueue({
      send: async (_phone, text) => {
        events.push(`start:${text}`)
        await Promise.resolve() // yield: an interleaving impl would slip here
        events.push(`end:${text}`)
      },
      delayMs: 0,
      jitterMs: 0,
      batchSize: 0,
      batchPauseMs: 0,
      now: c.now,
      sleep: c.sleep,
    })

    await Promise.all([queue.enqueue('+1', 'a'), queue.enqueue('+1', 'b')])

    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('propagates send failures to the caller without stalling the queue', async () => {
    const c = virtualClock()
    const sent: string[] = []
    const queue = createPacedQueue({
      send: async (_phone, text) => {
        if (text === 'boom') throw new Error('send failed')
        sent.push(text)
      },
      delayMs: 0,
      jitterMs: 0,
      batchSize: 0,
      batchPauseMs: 0,
      now: c.now,
      sleep: c.sleep,
    })

    await expect(queue.enqueue('+1', 'boom')).rejects.toThrow('send failed')
    await queue.enqueue('+1', 'ok')

    expect(sent).toEqual(['ok'])
  })
})
