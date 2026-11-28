// Lost-login checks (D50): coalesce repeated schedules and run the account checks concurrently. Plain TS, no electron.

export interface LoginScheduler {
  /** Ask for a check in `delay` ms. A call while one is pending, or within the coalesce window, is ignored. */
  schedule(delay: number): void
}

/**
 * One pending check at a time. Every WhatsApp load asks for a check; reloads in quick succession (extension or blur
 * toggles) must not queue one multi-second scan each. A gap longer than coalesceMs schedules a fresh check.
 */
export function createLoginScheduler(
  run: () => void | Promise<void>,
  opts: { coalesceMs?: number; now?: () => number } = {}
): LoginScheduler {
  const coalesceMs = opts.coalesceMs ?? 30_000
  const now = opts.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = Number.NEGATIVE_INFINITY
  const schedule = (delay: number): void => {
    const t = now()
    if (timer !== undefined || t - last < coalesceMs) return
    last = t
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, delay)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  return { schedule }
}
