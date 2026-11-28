// Main-frame load gating for waking an account (BG-017). No electron import.
export type SettledEmitter = {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}

/**
 * Calls done once when the main document settles: did-finish-load, a did-fail-load for the main frame only, or the
 * timeout. Electron also fires did-fail-load for iframes and ads; those are ignored so a half-loaded page is not
 * attached over the asleep panel.
 */
export function onceMainFrameSettled(wc: SettledEmitter, done: () => void, timeoutMs = 15_000): void {
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    wc.removeListener('did-finish-load', onFinish)
    wc.removeListener('did-fail-load', onFail)
    done()
  }
  const onFinish = () => finish()
  // did-fail-load(event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId)
  const onFail = (_e: unknown, _code: number, _desc: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame === false) return
    finish()
  }
  wc.on('did-finish-load', onFinish)
  wc.on('did-fail-load', onFail)
  const timer = setTimeout(finish, timeoutMs)
  timer.unref?.()
}
