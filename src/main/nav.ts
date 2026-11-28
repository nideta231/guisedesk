// Top bar Back and Forward (UX-013). Plain TS, no electron import: the caller passes a navigationHistory.
export interface HistoryLike {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
}

export interface NavState {
  canBack: boolean
  canForward: boolean
}

/** What the top bar shows: a direction is enabled only when the page has somewhere to go. */
export function navState(h: Pick<HistoryLike, 'canGoBack' | 'canGoForward'>): NavState {
  return { canBack: h.canGoBack(), canForward: h.canGoForward() }
}

/** Back if possible; false when there is no history in that direction. */
export function goBack(h: HistoryLike): boolean {
  if (!h.canGoBack()) return false
  h.goBack()
  return true
}

export function goForward(h: HistoryLike): boolean {
  if (!h.canGoForward()) return false
  h.goForward()
  return true
}
