// Caps Lock hint for the password lock screen (UX-029). Plain TS: no electron, no DOM dependency.
export interface ModifierEvent {
  getModifierState?: (key: string) => boolean
}

/** True when the keyboard event reports Caps Lock on. A missing method (jsdom, some synthetic events) is off. */
export function capsLockOn(e: ModifierEvent): boolean {
  return typeof e.getModifierState === 'function' && e.getModifierState('CapsLock') === true
}
