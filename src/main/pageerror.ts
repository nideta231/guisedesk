// Which page load failures deserve the retry card (UX-010). No electron import.

/** Chromium aborts a load for reasons of its own (a new navigation, a stopped load); that is not an error to show. */
export const ERR_ABORTED = -3

/** Only a failed main document is worth a card: iframes and ads fail all the time (BG-017). */
export function isReportableLoadError(isMainFrame: boolean, code: number): boolean {
  return isMainFrame && code !== ERR_ABORTED
}

/** After a failed load Chromium shows its own error page; its URL starts with chrome-error://. */
export function isErrorPageUrl(url: unknown): boolean {
  return typeof url === 'string' && /^chrome-error:/i.test(url)
}

/** A real page document the user could see, not Chromium's error page or another internal scheme. */
export function isRealPageUrl(url: unknown): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

export type LoadStart = {
  isMainFrame: boolean
  isSameDocument: boolean
  url: string
}

/**
 * A load start clears the retry card only for a real http(s) main-frame navigation. Chromium's error page fires
 * its own load events after did-fail-load; clearing on those would hide the card that was just shown.
 */
export function shouldClearErrorOnStart(s: LoadStart): boolean {
  return s.isMainFrame && !s.isSameDocument && isRealPageUrl(s.url)
}

/** A did-finish-load clears the card unless the document that finished is Chromium's error page. */
export function shouldClearErrorOnFinish(url: unknown): boolean {
  return !isErrorPageUrl(url)
}

/**
 * Re-attaching a view after a load start is allowed only for the selected view, while unlocked and with no
 * dialog/Settings/Add layer open. A page that reloads itself must never come back over the lock screen.
 */
export function shouldReattachOnLoad(
  s: LoadStart & { isSelected: boolean; unlocked: boolean; dialogOpen: boolean }
): boolean {
  return shouldClearErrorOnStart(s) && s.isSelected && s.unlocked && !s.dialogOpen
}
