// "About and data" actions (UX-007). Plain TS, no electron import: main passes the fs and shell calls in.
export interface AppOpenIo {
  /** GuiseDesk data folder (~/.config/GuiseDesk or the dev/test folder). */
  dir: string
  /** events.log inside that folder. */
  logPath: string
  exists(path: string): boolean
  /** shell.openPath: resolves to '' on success, or an error message. */
  openPath(path: string): Promise<string>
  showItemInFolder(path: string): void
}

/** Only the app window may open a data target; anything else is ignored. */
export async function openAppTarget(target: unknown, isAppSender: boolean, io: AppOpenIo): Promise<boolean> {
  if (!isAppSender) return false
  if (target === 'data') return (await io.openPath(io.dir)) === ''
  if (target === 'log') {
    if (!io.exists(io.logPath)) return false
    io.showItemInFolder(io.logPath)
    return true
  }
  return false
}
