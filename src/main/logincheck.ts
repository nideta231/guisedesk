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

export interface LoginAccount {
  id: string
  serviceId: string
}

export interface LoginStates {
  /** WhatsApp login state from its IndexedDB store and loaded page; undefined when it cannot be decided. */
  whatsapp: (a: LoginAccount) => Promise<boolean | undefined>
  /** Cookie-based login state; undefined for a service without a login cookie rule. */
  cookie: (a: LoginAccount) => Promise<boolean | undefined>
  /** How many WhatsApp views may run their page check at once (each can wait seconds for a load). */
  whatsappConcurrency?: number
}

/**
 * Collects every account's login state concurrently, so startup takes the slowest account rather than the sum.
 * WhatsApp page checks are capped (default 3 concurrent) to avoid many executeJavaScript calls at once.
 */
export async function collectLogins(accounts: LoginAccount[], states: LoginStates): Promise<Record<string, boolean>> {
  const now: Record<string, boolean> = {}
  const wa = accounts.filter((a) => a.serviceId === 'whatsapp')
  const rest = accounts.filter((a) => a.serviceId !== 'whatsapp')
  const limit = Math.max(1, states.whatsappConcurrency ?? 3)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < wa.length) {
      const a = wa[next++]
      const state = await states.whatsapp(a)
      if (state !== undefined) now[a.id] = state
    }
  }
  const jobs: Promise<void>[] = []
  for (let i = 0; i < Math.min(limit, wa.length); i++) jobs.push(worker())
  for (const a of rest) {
    jobs.push(
      states.cookie(a).then((state) => {
        if (state !== undefined) now[a.id] = state
      })
    )
  }
  await Promise.all(jobs)
  return now
}
