// Page loading indicator (UX-046). Plain TS: no electron import, so the debounce decision is testable.
export const LOADING_DEBOUNCE_MS = 200
// A page that never fires did-stop-loading must not leave the bar on forever.
export const LOADING_CEILING_MS = 30_000

export interface LoadingEvent {
  type: 'start' | 'stop' | 'ceiling'
  /** Milliseconds since the load started (only for a start). */
  elapsed?: number
}

/** The next loading flag: a start shows only after the debounce, a stop or the ceiling hides it. */
export function loadingAfter(prev: boolean, event: LoadingEvent): boolean {
  if (event.type === 'stop' || event.type === 'ceiling') return false
  return prev || (event.elapsed ?? 0) >= LOADING_DEBOUNCE_MS
}
