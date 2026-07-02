// Fire-and-forget runner for work that must outlive the HTTP request that starts
// it — e.g. a paced WhatsApp broadcast that takes ~30 min, far longer than any
// gateway timeout. The route returns immediately and the work continues here.
// In-flight jobs are tracked so tests can deterministically await them via
// flushBackground() instead of racing on timers.

const inFlight = new Set<Promise<unknown>>()

export function runInBackground(work: Promise<unknown>, label: string): void {
  const tracked = work
    .then((result) => {
      console.info(`[background] ${label} done`, result ? JSON.stringify(result) : "")
    })
    .catch((err: Error) => {
      console.error(`[background] ${label} failed:`, err.message)
    })
    .finally(() => {
      inFlight.delete(tracked)
    })
  inFlight.add(tracked)
}

// Resolves once all currently in-flight background jobs settle. For tests only.
export function flushBackground(): Promise<unknown> {
  return Promise.allSettled([...inFlight])
}
