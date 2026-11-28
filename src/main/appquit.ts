// Quit action from Settings > General (UX-031). Plain TS, no electron import: main passes app.quit in.
/** Only the app window may quit; a popup or service view is ignored. Returns whether quit ran. */
export function runQuit(isAppSender: boolean, quit: () => void): boolean {
  if (!isAppSender) return false
  quit()
  return true
}
