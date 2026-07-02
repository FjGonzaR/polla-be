// A single-flight, rate-limited send queue. Pacing is enforced by wall-clock gap
// since the last actual send (not by how many items are queued), so callers that
// await each send sequentially — the crons and broadcasts all do — are throttled
// just the same. The old queue only slept when another item was still enqueued,
// which made pacing a no-op for sequential callers and let bursts go out
// unthrottled (the likely cause of the WhatsApp ban).

export interface PacedQueueOptions {
  send: (phone: string, text: string) => Promise<void>
  delayMs: number
  jitterMs: number
  batchSize: number
  batchPauseMs: number
  onBatchPause?: (queued: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface PacedQueue {
  enqueue: (phone: string, text: string) => Promise<void>
}

interface QueuedSend {
  phone: string
  text: string
  resolve: () => void
  reject: (err: Error) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createPacedQueue(opts: PacedQueueOptions): PacedQueue {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep

  const queue: QueuedSend[] = []
  let running = false
  let lastSentAt = 0
  let sentSinceBatchPause = 0

  async function waitForSlot(): Promise<void> {
    if (opts.batchSize > 0 && sentSinceBatchPause >= opts.batchSize) {
      sentSinceBatchPause = 0
      opts.onBatchPause?.(queue.length)
      await sleep(opts.batchPauseMs)
      return
    }

    if (lastSentAt === 0) return // first send ever — no wait
    const jitter =
      opts.jitterMs > 0 ? Math.floor(Math.random() * opts.jitterMs) : 0
    const remaining = opts.delayMs + jitter - (now() - lastSentAt)
    if (remaining > 0) await sleep(remaining)
  }

  // Never runs concurrently with itself (guarded by `running`), so sends are
  // strictly serialized even across overlapping enqueue calls.
  async function processQueue(): Promise<void> {
    if (running) return
    running = true
    try {
      while (queue.length > 0) {
        const job = queue.shift()!
        await waitForSlot()
        try {
          await opts.send(job.phone, job.text)
          job.resolve()
        } catch (err) {
          job.reject(err as Error)
        }
        lastSentAt = now()
        sentSinceBatchPause++
      }
    } finally {
      running = false
    }
  }

  return {
    enqueue(phone: string, text: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        queue.push({ phone, text, resolve, reject })
        void processQueue()
      })
    },
  }
}
