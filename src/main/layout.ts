// Window layout numbers shared by the renderer (Sidebar.vue) and main (service view bounds). D24, D26.
export const SIDE_FULL = 232
export const SIDE_MINI = 64
// Drag-resizable full width (D52), saved in settings.json sidebarWidth.
// Hidden: a 24px strip keeps the show button reachable (the page view would cover it otherwise).
export const SIDE_HIDDEN = 24
export const SIDE_MIN = 180
export const SIDE_MAX = 420
export const clampSide = (w: unknown): number => (typeof w === 'number' && Number.isFinite(w) ? Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w))) : SIDE_FULL)
// Main area padding around the content panel: top 12, left/right 16, bottom 16.
export const PAD_TOP = 12
export const PAD_X = 16
export const PAD_BOTTOM = 16
// Account top bar above the panel (frame 1, v5 compact): 34px tall plus a 12px gap.
export const TOP_BAR_H = 34
export const TOP_BAR_GAP = 12

/** Sidebar width: 0 when hidden (D52), the rail when collapsed, else the saved full width. */
export const sideWidth = (collapsed: boolean, width: number = SIDE_FULL, hidden = false): number => (hidden ? SIDE_HIDDEN : collapsed ? SIDE_MINI : clampSide(width))

/** Where the selected service view goes, inside a window of the given content size. */
export function panelBounds(w: number, h: number, collapsed: boolean, width: number = SIDE_FULL, hidden = false) {
  const side = sideWidth(collapsed, width, hidden)
  return { x: side + PAD_X, y: PAD_TOP + TOP_BAR_H + TOP_BAR_GAP, width: Math.max(0, w - side - 2 * PAD_X), height: Math.max(0, h - PAD_TOP - TOP_BAR_H - TOP_BAR_GAP - PAD_BOTTOM) }
}

// Split view (D62): the divider stays between 20 and 80 percent, with a small gap the renderer draws.
export const SPLIT_MIN = 0.2
export const SPLIT_MAX = 0.8
export const SPLIT_GAP = 10
export const clampSplit = (r: unknown): number => (typeof r === 'number' && Number.isFinite(r) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r)) : 0.5)

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The two page bounds for a split panel: the divider is at `ratio` of the panel width, with a gap on either side. */
export function splitBounds(panel: Bounds, ratio: number): { left: Bounds; right: Bounds } {
  const r = clampSplit(ratio)
  const center = panel.x + Math.round(panel.width * r)
  const half = Math.floor(SPLIT_GAP / 2)
  const rightX = center + (SPLIT_GAP - half)
  return {
    left: { x: panel.x, y: panel.y, width: Math.max(0, center - panel.x - half), height: panel.height },
    right: { x: rightX, y: panel.y, width: Math.max(0, panel.x + panel.width - rightX), height: panel.height }
  }
}

/** A pointer position inside the panel as a clamped split ratio. */
export const splitRatioAt = (clientX: number, left: number, width: number): number => (width > 0 ? clampSplit((clientX - left) / width) : 0.5)

/** The next row in a flat list for the sidebar's arrow keys (UX-001). index < 0 starts at the matching end. */
export function nextRow(index: number, delta: number, length: number, wrap: boolean): number {
  if (length <= 0) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1
  const next = index + delta
  if (wrap) return ((next % length) + length) % length
  return Math.min(length - 1, Math.max(0, next))
}

/** Ctrl+B, as Electron reports it in before-input-event. */
export const isSidebarShortcut = (i: { type: string; control?: boolean; alt?: boolean; meta?: boolean; key: string }): boolean =>
  i.type === 'keyDown' && !!i.control && !i.alt && !i.meta && i.key.toLowerCase() === 'b'
