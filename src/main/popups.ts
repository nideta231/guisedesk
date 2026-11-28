// Popup windows (D37). Plain TS, no electron: where a link opens, and the registry of open popups.
import type { Account } from './accounts'
import { route } from './links'

export type Target = 'popup' | 'same-view' | 'external' | 'deny'

/** Same-service links opened as a background or foreground tab (middle-click, Ctrl+click) get a popup; other dispositions keep today's behaviour. */
export function openTarget(disposition: string, action: 'in-app' | 'external' | 'deny'): Target {
  if (action !== 'in-app') return action
  return disposition === 'background-tab' || disposition === 'foreground-tab' ? 'popup' : 'same-view'
}

/** Open popups by account id. `close` is injected so the registry needs no electron. */
export function createPopups<W>(close: (w: W) => void) {
  const open = new Map<W, string>()
  const closeWhere = (pick: (id: string) => boolean) => {
    for (const [w, id] of [...open]) {
      if (!pick(id)) continue
      open.delete(w)
      close(w)
    }
  }
  return {
    add: (accountId: string, w: W) => void open.set(w, accountId),
    /** A popup that closed itself. */
    forget: (w: W) => void open.delete(w),
    closeFor: (accountId: string) => closeWhere((id) => id === accountId),
    closeAll: () => closeWhere(() => true),
    count: () => open.size
  }
}

/** A popup request from a service view (D38): the URL to open, only when it routes in-app for the account. */
export function acceptPopupRequest(url: unknown, account: Account): string | null {
  if (typeof url !== 'string') return null
  const r = route(url, account)
  return r.action === 'in-app' ? r.url : null
}

const TITLE_MAX = 80

/** Popup window title (UX-047): the page title, then the account label; an empty page title falls back to the service. */
export function popupTitle(pageTitle: string, label: string, service: string): string {
  const head = pageTitle.trim() || service.trim()
  const tail = label.trim()
  const full = tail ? `${head} · ${tail}` : head
  return full.length > TITLE_MAX ? `${full.slice(0, TITLE_MAX - 1).trimEnd()}…` : full
}

/** Sets the window title and returns it; the window is a plain object in tests. */
export function applyPopupTitle(w: { setTitle(title: string): void }, pageTitle: string, label: string, service: string): string {
  const title = popupTitle(pageTitle, label, service)
  w.setTitle(title)
  return title
}
