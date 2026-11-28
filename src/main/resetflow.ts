// Reset order (D14): popups close first (they hold live sessions), then storage is cleared, then the files go.
// Plain TS, no electron: the real work is injected so vitest can record the order.
export interface ResetFlowDeps {
  closePopups: () => void
  clearStorage: () => Promise<void> | void
  wipe: () => { ok: true } | { error: string }
}

export async function runReset(deps: ResetFlowDeps): Promise<{ ok: true } | { error: string }> {
  deps.closePopups()
  await deps.clearStorage()
  return deps.wipe()
}
