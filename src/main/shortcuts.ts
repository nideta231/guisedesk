// Keyboard shortcuts seen by before-input-event (D32 zoom, D33 switching). Plain TS: no electron, no fs.
export interface KeyInput {
  type: string
  key: string
  code?: string
  control?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

export type ZoomDir = 'in' | 'out' | 'reset'
export const ZOOM_MIN = -3
export const ZOOM_MAX = 5

/** Ctrl+K (D59): the quick switcher, handled in the app window and in service views. */
export const isSwitcherShortcut = (i: { type: string; control?: boolean; alt?: boolean; meta?: boolean; shift?: boolean; key: string }): boolean =>
  i.type === 'keyDown' && !!i.control && !i.alt && !i.meta && !i.shift && i.key.toLowerCase() === 'k'

/** F1 (D60): the shortcut cheat sheet, from anywhere in the app. */
export const isHelpShortcut = (i: { type: string; key: string }): boolean => i.type === 'keyDown' && i.key === 'F1'

/** Ctrl+, (UX-036): Settings, the same key most desktop apps use for preferences. */
export const isSettingsShortcut = (i: { type: string; control?: boolean; alt?: boolean; meta?: boolean; shift?: boolean; key: string }): boolean =>
  i.type === 'keyDown' && !!i.control && !i.alt && !i.meta && !i.shift && i.key === ','

export interface ShortcutInfo {
  group: string
  keys: string
  title: string
}

/** Every shortcut the app actually has (D60). One list, shared by the cheat sheet and its test. */
export const SHORTCUTS: ShortcutInfo[] = [
  { group: 'Accounts', keys: 'Ctrl+1 … Ctrl+9', title: 'Switch to that account in the sidebar' },
  { group: 'Accounts', keys: 'Ctrl+Tab / Ctrl+Shift+Tab', title: 'Next / previous account' },
  { group: 'Accounts', keys: 'Ctrl+K', title: 'Quick switcher' },
  { group: 'Window', keys: 'Ctrl+B', title: 'Show or collapse the sidebar' },
  { group: 'Window', keys: 'Ctrl+= / Ctrl+-', title: 'Zoom in / out' },
  { group: 'Window', keys: 'Ctrl+0', title: 'Reset zoom' },
  { group: 'Window', keys: 'Ctrl+,', title: 'Settings' },
  { group: 'Window', keys: 'Esc', title: 'Close a dialog or Settings' },
  { group: 'Window', keys: 'F1', title: 'Keyboard shortcuts' },
  { group: 'Window', keys: '?', title: 'Keyboard shortcuts (app window, not in a field)' },
  { group: 'Privacy', keys: 'Ctrl+L', title: 'Lock now' },
  { group: 'Links and popups', keys: 'Middle-click or Ctrl+click', title: 'Open a link in a popup window' },
  { group: 'Links and popups', keys: 'Ctrl+W or Esc', title: 'Close a popup window' }
]

/** Ctrl+=, Ctrl++ (with Shift), Ctrl+-, Ctrl+0, also the numpad keys; anything else is null. */
export function zoomKey(i: KeyInput): ZoomDir | null {
  if (i.type !== 'keyDown' || !i.control || i.alt || i.meta) return null
  if (i.key === '=' || i.key === '+' || i.code === 'NumpadAdd') return 'in'
  if (i.key === '-' || i.code === 'NumpadSubtract') return 'out'
  if (i.key === '0' || i.code === 'Numpad0') return 'reset'
  return null
}

/** One zoom step of 0.5, kept inside -3..5; reset gives 0. */
export function nextZoom(level: number, dir: ZoomDir): number {
  if (dir === 'reset') return 0
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level + (dir === 'in' ? 0.5 : -0.5)))
}

/** Chromium zoom level as the percent people know: 1 -> 120. */
export const zoomPercent = (level: number): number => Math.round(100 * 1.2 ** level)

/**
 * Ctrl+1..9 -> the nth id, Ctrl+Tab -> next, Ctrl+Shift+Tab -> previous (both wrap); ids are in sidebar order.
 * No selection: next gives the first, previous the last. Null when the key is not a switch key or there is no such account.
 */
export function switchTarget(i: KeyInput, ids: string[], selectedId: string | undefined): string | null {
  if (i.type !== 'keyDown' || !i.control || i.alt || i.meta || !ids.length) return null
  if (/^[1-9]$/.test(i.key) && !i.shift) return ids[Number(i.key) - 1] ?? null
  if (i.key !== 'Tab') return null
  const at = ids.indexOf(selectedId ?? '')
  const step = i.shift ? -1 : 1
  if (at < 0) return i.shift ? ids[ids.length - 1] : ids[0]
  return ids[(at + step + ids.length) % ids.length]
}
