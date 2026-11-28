// Right-click menu inside service views (D30). Plain TS, no electron import: returns action ids, main maps them to calls.
export interface MenuParams {
  linkURL: string
  srcURL: string
  mediaType: string
  selectionText: string
  isEditable: boolean
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
  misspelledWord: string
  dictionarySuggestions: string[]
}

export interface MenuState {
  canGoBack: boolean
  canGoForward: boolean
  locked: boolean
  /** Other accounts of this service on another partition (D46). */
  siblings?: number
}

export interface MenuItem {
  label: string
  action: string
  enabled: boolean
  /** Replacement word for the spell action. */
  value?: string
}
export type MenuEntry = MenuItem | { type: 'separator' }

const item = (label: string, action: string, enabled = true): MenuItem => ({ label, action, enabled })

export function buildContextMenu(p: MenuParams, s: MenuState): MenuEntry[] {
  if (s.locked) return []
  const groups: MenuItem[][] = []
  if (p.isEditable && p.misspelledWord)
    groups.push(p.dictionarySuggestions.map((w) => ({ ...item(w, 'spell'), value: w })))
  if (p.linkURL) {
    const g: MenuItem[] = []
    if (/^https?:\/\//i.test(p.linkURL)) g.push(item('Open link in browser', 'open-link'))
    g.push(item('Copy link address', 'copy-link'))
    groups.push(g)
  }
  if (s.siblings) groups.push([item('Open in another account', 'open-in-other')])
  if (p.mediaType === 'image' && p.srcURL)
    groups.push([item('Save image', 'save-image'), item('Copy image', 'copy-image'), item('Copy image address', 'copy-image-address')])
  if (p.isEditable) {
    const f = p.editFlags
    groups.push([
      item('Undo', 'undo', f.canUndo),
      item('Redo', 'redo', f.canRedo),
      item('Cut', 'cut', f.canCut),
      item('Copy', 'copy', f.canCopy),
      item('Paste', 'paste', f.canPaste),
      item('Select all', 'select-all', f.canSelectAll)
    ])
  } else if (p.selectionText) groups.push([item('Copy', 'copy')])
  groups.push([item('Back', 'back', s.canGoBack), item('Forward', 'forward', s.canGoForward), item('Reload', 'reload')])
  return groups
    .filter((g) => g.length)
    .flatMap((g, i): MenuEntry[] => (i ? [{ type: 'separator' }, ...g] : g))
}

/** Sidebar account row menu (D19, D27, D41): shown as a native menu so it draws over the service view. */
export function rowMenuItems(s: { muted: boolean; asleep: boolean }): { action: string; label: string }[] {
  return [
    { action: 'mute', label: s.muted ? 'Unmute' : 'Mute' },
    { action: 'reload', label: 'Reload' },
    { action: 'home', label: 'Go to start page' },
    ...(s.asleep ? [] : [{ action: 'sleep', label: 'Sleep now' }]),
    { action: 'account', label: 'Account settings' }
  ]
}
