// First window close (UX-032): explain that the app keeps running in the tray. Plain TS, no electron import.
export function shouldShowTrayHint(shown: boolean): boolean {
  return !shown
}

export interface TrayHintIo {
  /** Whether the one-time hint was already shown (settings.json key trayHintShown). */
  shown(): boolean
  /** Saves the flag so later closes stay quiet. */
  save(): void
  /** Shows the native notification; it carries no account data, even while locked. */
  notify(): void
}

/** Shows and records the hint at most once. Returns whether it showed now. */
export function maybeShowTrayHint(io: TrayHintIo): boolean {
  if (!shouldShowTrayHint(io.shown())) return false
  io.notify()
  io.save()
  return true
}
