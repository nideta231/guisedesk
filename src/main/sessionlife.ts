// Session persistence (D50 follow-up): flush cookies and storage before sleep or quit. Plain TS, no electron
// import: callers pass the sessions in, so the ordering and the quit timeout are tested directly.
export interface SessionLike {
  cookies: { flushStore(): Promise<void> }
  flushStorageData(): void
}

/** Unique partition keys: accounts sharing a login share one session and must be flushed once. */
export function sessionKeys(accounts: { id: string; shareWith?: string }[]): string[] {
  return [...new Set(accounts.map((a) => a.shareWith ?? a.id))]
}

/** Flushes one session at most once, even when quit and sleep both ask for it. Never rejects. */
export function flushSessionOnce(ses: SessionLike, seen: WeakSet<object> = new WeakSet()): Promise<void> {
  if (seen.has(ses)) return Promise.resolve()
  seen.add(ses)
  try {
    ses.flushStorageData()
  } catch { /* one broken session must not stop the others */ }
  try {
    return Promise.resolve(ses.cookies.flushStore()).then(() => undefined, () => undefined)
  } catch {
    return Promise.resolve()
  }
}

/** Flushes every partition key; the timeout caps a stuck disk so quitting still finishes. */
export function flushSessions(keys: string[], sessionFor: (key: string) => SessionLike, timeoutMs = 2000): Promise<void> {
  const seen = new WeakSet<object>()
  const work = keys.map((key) => {
    try {
      return flushSessionOnce(sessionFor(key), seen)
    } catch {
      return Promise.resolve()
    }
  })
  if (!work.length) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    void Promise.all(work).then(finish)
  })
}
