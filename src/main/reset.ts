// Reset (D14): the file part of "forgot PIN". Plain TS, only ever touches paths inside the data dir.
import { readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { writeAtomic } from './atomic'

export const RESET_WORD = 'RESET'

/** settings.json keys that belong to accounts and must not survive a reset (proxy passwords especially). */
const ACCOUNT_SETTINGS = ['proxyAuth', 'split', 'selectedAccount'] as const

/** Removes the account-specific settings, keeping DND, the lock schedule and download preferences. */
export function clearAccountSettings(dir: string): void {
  let settings: Record<string, unknown>
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    settings = parsed
  } catch {
    return
  }
  let changed = false
  for (const key of ACCOUNT_SETTINGS) {
    if (key in settings) {
      delete settings[key]
      changed = true
    }
  }
  if (changed) writeAtomic(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), undefined, 0o600)
}

/** Removes each target (file or dir); throws before removing anything if one is not strictly inside dir. */
export function wipeFiles(dir: string, targets: string[]): void {
  if (!isAbsolute(dir)) throw new Error('data dir must be absolute')
  const root = resolve(dir)
  for (const t of targets) {
    const rel = relative(root, resolve(t))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`refusing to remove a path outside the data dir: ${t}`)
  }
  for (const t of targets) rmSync(resolve(t), { recursive: true, force: true })
}

/** After RESET is typed: remove accounts.json, logins.json, lock.json, cached icons and the partition dirs; keep non-account settings. */
export function resetData(dir: string, typed: unknown): { ok: true } | { error: string } {
  if (typed !== RESET_WORD) return { error: `Type ${RESET_WORD} to confirm` }
  wipeFiles(dir, [join(dir, 'accounts.json'), join(dir, 'logins.json'), join(dir, 'lock.json'), join(dir, 'icons'), join(dir, 'Partitions')])
  clearAccountSettings(dir)
  return { ok: true }
}
