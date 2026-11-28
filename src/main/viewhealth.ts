// Renderer crash / hang recovery for one service view (BG-020). No electron import.
export interface HealthEmitter {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}

export interface ViewHealthOptions {
  /** Reload the view after a renderer crash. */
  reload: () => void
  /** Tell the user the view is hung and that it can be reloaded. */
  notify: () => void
  log: (line: string) => void
  /** Timeout scheduler, injected so tests need no real timers. */
  schedule?: (fn: () => void, ms: number) => unknown
  now?: () => number
  /** Wait before reloading so a crashing page's own teardown finishes. */
  delayMs?: number
  /** Sliding window and cap for automatic reloads, so a crash loop cannot spin the machine. */
  windowMs?: number
  maxReloads?: number
}

/**
 * Watches one view: a renderer crash reloads it once after a short delay (never for a clean exit), an unresponsive
 * renderer tells the user instead of freezing silently, and repeated crashes inside the window stop the reload loop.
 */
export function watchViewHealth(wc: HealthEmitter, opts: ViewHealthOptions): () => void {
  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    })
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? 1500
  const windowMs = opts.windowMs ?? 60_000
  const maxReloads = opts.maxReloads ?? 3
  let reloads: number[] = []
  let disposed = false

  const onGone = (_e: unknown, details: { reason?: string } = {}) => {
    const reason = details?.reason ?? 'unknown'
    if (disposed || reason === 'clean-exit') return
    const t = now()
    reloads = reloads.filter((x) => t - x < windowMs)
    if (reloads.length >= maxReloads) {
      opts.log(`view crashed (${reason}); reload limit reached`)
      return
    }
    reloads.push(t)
    opts.log(`view crashed (${reason}); reloading`)
    schedule(() => {
      if (!disposed) opts.reload()
    }, delayMs)
  }

  const onUnresponsive = () => {
    if (disposed) return
    opts.log('view unresponsive')
    opts.notify()
  }

  wc.on('render-process-gone', onGone)
  wc.on('unresponsive', onUnresponsive)
  return () => {
    disposed = true
    wc.removeListener('render-process-gone', onGone)
    wc.removeListener('unresponsive', onUnresponsive)
  }
}
