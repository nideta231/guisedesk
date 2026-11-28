// Tray menu template (D4, D19). Plain TS: no electron import, so it is testable.
import { sidebarOrder } from './services'

export interface TrayMenuItem {
  label?: string
  accelerator?: string
  /** false = the label only; the shortcut itself is handled by the window, not registered by the menu. */
  registerAccelerator?: boolean
  type?: 'checkbox' | 'separator'
  checked?: boolean
  submenu?: TrayMenuItem[]
  click?: (item: { checked: boolean }) => void
}

/** One account row in the tray's Unread submenu (UX-034). */
export interface TrayUnreadItem {
  id: string
  label: string
  count: number
}

export interface TrayActions {
  dnd: boolean
  unread?: TrayUnreadItem[]
  onUnread?: (id: string) => void
  onLock: () => void
  onShow: () => void
  onSettings: () => void
  onDnd: (on: boolean) => void
  onReloadAll: () => void
  onSleepAll: () => void
  onQuit: () => void
}

/** The accounts with unread messages, in sidebar order; a switched-off service is left out (UX-034, BG-016). */
export function trayUnreadItems<T extends { id: string; label: string; serviceId: string; order: number; enabled?: boolean }>(
  counts: Record<string, number>,
  accounts: T[]
): TrayUnreadItem[] {
  return sidebarOrder(accounts.filter((a) => a.enabled !== false && (counts[a.id] ?? 0) > 0)).map((a) => ({
    id: a.id,
    label: a.label,
    count: counts[a.id]
  }))
}

export function trayTemplate(o: TrayActions): TrayMenuItem[] {
  return [
    { label: 'Show GuiseDesk', click: o.onShow },
    { label: 'Lock now', accelerator: 'Ctrl+L', registerAccelerator: false, click: o.onLock },
    { label: 'Do Not Disturb', type: 'checkbox', checked: o.dnd, click: (m) => o.onDnd(m.checked) },
    ...(o.unread?.length
      ? [
          {
            label: `Unread (${o.unread.reduce((n, u) => n + u.count, 0)})`,
            submenu: o.unread.map((u) => ({ label: `${u.label} (${u.count})`, click: () => o.onUnread?.(u.id) }))
          }
        ]
      : []),
    { type: 'separator' },
    { label: 'Reload all accounts', click: o.onReloadAll },
    { label: 'Sleep all accounts', click: o.onSleepAll },
    { label: 'Settings', click: o.onSettings },
    { type: 'separator' },
    { label: 'Quit', click: o.onQuit }
  ]
}

export type BulkAction = 'reload' | 'sleep'

/** Which accounts a tray bulk action acts on (UX-033): reload every enabled account, sleep all but the selected one. */
export function bulkTargets<T extends { id: string; enabled?: boolean }>(accounts: T[], selectedId: string | undefined, action: BulkAction): T[] {
  return accounts.filter((a) => a.enabled !== false && (action === 'reload' || a.id !== selectedId))
}

/** Tray icon file and tooltip: the unread dot is hidden while locked (D16). */
export function trayLook(total: number, locked: boolean): { icon: string; tooltip: string } {
  return total > 0 && !locked
    ? { icon: 'tray-dot.png', tooltip: `GuiseDesk (${total} unread)` }
    : { icon: 'tray.png', tooltip: 'GuiseDesk' }
}

export type TrayIcon = 'plain' | 'dot'

/** Which image an update needs: 'same' while the look stays dot or plain, so the PNG is not read again for a count change. */
export function trayChange(prev: { total: number; locked: boolean }, next: { total: number; locked: boolean }): TrayIcon | 'same' {
  const before = trayLook(prev.total, prev.locked).icon
  const after = trayLook(next.total, next.locked).icon
  if (before === after) return 'same'
  return after === 'tray-dot.png' ? 'dot' : 'plain'
}
