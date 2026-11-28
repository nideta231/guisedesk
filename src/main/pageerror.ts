// Which page load failures deserve the retry card (UX-010). No electron import.

/** Chromium aborts a load for reasons of its own (a new navigation, a stopped load); that is not an error to show. */
export const ERR_ABORTED = -3

/** Only a failed main document is worth a card: iframes and ads fail all the time (BG-017). */
export function isReportableLoadError(isMainFrame: boolean, code: number): boolean {
  return isMainFrame && code !== ERR_ABORTED
}
