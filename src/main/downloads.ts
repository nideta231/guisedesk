// Downloads (D31): settings.json key `downloads`, unique save names, finished-notice text. Plain TS, no electron import.
import { readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { writeAtomic } from './atomic'

export interface DownloadSettings {
  dir?: string
  ask: boolean
}

function readAll(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

export function loadDownloads(dir: string): DownloadSettings {
  const d = readAll(dir).downloads as { dir?: unknown; ask?: unknown } | undefined
  const out: DownloadSettings = { ask: d?.ask === true }
  if (typeof d?.dir === 'string' && d.dir) out.dir = d.dir
  return out
}

export function saveDownloads(dir: string, value: DownloadSettings): void {
  const downloads: DownloadSettings = value.dir ? { dir: value.dir, ask: value.ask } : { ask: value.ask }
  writeAtomic(join(dir, 'settings.json'), JSON.stringify({ ...readAll(dir), downloads }, null, 2), undefined, 0o600)
}

/** Safe file name: no folders, no leading dots; "download" when nothing is left. */
function safeName(name: string): string {
  const last = basename(name.replace(/\\/g, '/').replace(/\0/g, '')).replace(/^\.+/, '').trim()
  return last || 'download'
}

/** The saved folder only while it still exists; an unplugged drive falls back to the system Downloads folder. */
export function pickFolder(saved: string | undefined, system: string, exists: (path: string) => boolean): string {
  return saved && exists(saved) ? saved : system
}

/** dir/name, or dir/name (1).ext, (2)... for the first one that does not exist. */
export function uniquePath(dir: string, name: string, exists: (path: string) => boolean): string {
  const safe = safeName(name)
  const ext = extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let p = join(dir, safe)
  for (let n = 1; exists(p); n++) p = join(dir, `${stem} (${n})${ext}`)
  return p
}

/** How a finished download is reported: a user cancel is silent, a completed one is ok, anything else failed. */
export function downloadOutcome(state: string): 'ok' | 'failed' | 'silent' {
  if (state === 'cancelled') return 'silent'
  return state === 'completed' ? 'ok' : 'failed'
}

/** Text of the finished notification. Locked hides the file name. */
export function doneNotice(s: { ok: boolean; file: string; locked: boolean }): { title: string; body: string } {
  if (!s.ok) return { title: 'Download failed', body: '' }
  if (s.locked) return { title: 'Download finished', body: '' }
  return { title: `Downloaded ${s.file}`, body: '' }
}
