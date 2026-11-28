// Unread counts from page titles. No electron import.
import type { Preset } from './presets'

/** Count shown for a title: "(3) X" -> 3, "(99+) X" -> 100 (more than 99), Discord "• X" -> 1, else 0. */
export function parseUnread(title: string, preset: Preset | undefined): number {
  const m = /^\((\d+)(\+?)\)/.exec(title) ?? /^(\d+)()\s+unread\b/i.exec(title)
  if (m) {
    const n = Number(m[1])
    return m[2] && n <= 99 ? 100 : n
  }
  return preset?.id === 'discord' && title.startsWith('•') ? 1 : 0
}

export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/** Total for the tray; with `enabled`, accounts of a switched-off service are left out. */
export function totalUnread(counts: Record<string, number>, enabled?: readonly string[]): number {
  if (!enabled) return Object.values(counts).reduce((s, n) => s + n, 0)
  const ids = new Set(enabled)
  let total = 0
  for (const [id, n] of Object.entries(counts)) if (ids.has(id)) total += n
  return total
}

/** The same counts without one account, for a logout that must stop advertising its old badge. */
export function without(counts: Record<string, number>, id: string): Record<string, number> {
  const out = { ...counts }
  delete out[id]
  return out
}

/** The window title (UX-011): the unread total while unlocked, plain while locked. */
export function windowTitle(total: number, locked: boolean): string {
  return !locked && total > 0 ? `(${total}) GuiseDesk` : 'GuiseDesk'
}

/** Applies the title through a tiny window interface so vitest can pass a fake. */
export function updateWindowTitle(win: { setTitle(title: string): void }, total: number, locked: boolean): string {
  const title = windowTitle(total, locked)
  win.setTitle(title)
  return title
}

/** The launcher/dock badge (UX-012): only Linux and macOS show it, and only while unlocked. */
export function badgeCount(total: number, locked: boolean, platform: string): number {
  return !locked && (platform === 'linux' || platform === 'darwin') ? total : 0
}

/** Sets the badge through a tiny app interface; an unsupported desktop must not throw. */
export function applyBadge(app: { setBadgeCount(count: number): unknown }, total: number, locked: boolean, platform: string): void {
  try {
    app.setBadgeCount(badgeCount(total, locked, platform))
  } catch {
    // Some Linux desktops do not implement the badge; ignore it.
  }
}
