// Every IPC channel that returns or acts on account data is registered through this, so it refuses while locked
// (or in setup). Lock channels use ipcMain directly. No electron import: the ipc object is passed in.
type Fn = (...a: any[]) => unknown

export interface IpcLike {
  removeHandler(channel: string): void
  handle(channel: string, fn: (...a: any[]) => unknown): void
  removeAllListeners(channel: string): void
  on(channel: string, fn: (...a: any[]) => void): void
}

/** Wraps a one-way handler so it only runs for the app window's own sender (a popup or service view is ignored). */
export function appOnly<E, F extends (...a: any[]) => unknown>(isApp: (e: E) => boolean, fn: F): (e: E, ...a: Parameters<F>) => ReturnType<F> | undefined {
  return (e, ...a) => (isApp(e) ? (fn(...a) as ReturnType<F>) : undefined)
}

export function createGuardedIpc(ipc: IpcLike, isUnlocked: () => boolean) {
  return {
    /** Request/response channel: while locked the call is rejected and the handler never runs. */
    handle(channel: string, fn: Fn): void {
      ipc.removeHandler(channel)
      ipc.handle(channel, (...a) => {
        if (!isUnlocked()) throw new Error('locked')
        return (fn as (...x: unknown[]) => unknown)(...a)
      })
    },
    /** One-way channel: while locked the message is dropped. */
    on(channel: string, fn: Fn): void {
      ipc.removeAllListeners(channel)
      ipc.on(channel, (...a) => {
        if (!isUnlocked()) return
        ;(fn as (...x: unknown[]) => unknown)(...a)
      })
    }
  }
}
