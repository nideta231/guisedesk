// Diagnostic event log (D50): <data>/events.log, one timestamped line per event (start, quit, logout, remove,
// lost login). The user reported logins vanishing without knowing why; this records what happened around it.
// Plain TS, no electron import. Rotated at 512 KB (one .1 copy kept).
import { appendFileSync, chmodSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX = 512 * 1024

export function appendEvent(dir: string, line: string, now: Date = new Date()): void {
  try {
    const file = join(dir, 'events.log')
    if (existsSync(file) && statSync(file).size > MAX) renameSync(file, file + '.1')
    // The log holds account labels, ids, lost-login reasons and proxy endpoints, so only the user may read it.
    appendFileSync(file, `${now.toISOString()} ${line.replace(/\n/g, ' ')}\n`, { mode: 0o600 })
    chmodSync(file, 0o600)
  } catch { /* logging must never break the app */ }
}

/** Login cookie names per service: present = logged in. */
export const LOGIN_COOKIES: Record<string, { domain: string; names: string[] }> = {
  instagram: { domain: 'instagram.com', names: ['sessionid'] },
  threads: { domain: 'threads.com', names: ['sessionid'] },
  facebook: { domain: 'facebook.com', names: ['c_user', 'xs'] },
  x: { domain: 'x.com', names: ['auth_token'] },
  tiktok: { domain: 'tiktok.com', names: ['sessionid'] },
  discord: { domain: 'discord.com', names: [] }
}

/** Accounts whose login was present last start and is gone now. Pure: state in, state out. */
export function lostLogins(prev: Record<string, boolean>, now: Record<string, boolean>): string[] {
  return Object.keys(now).filter((id) => prev[id] === true && now[id] === false)
}
