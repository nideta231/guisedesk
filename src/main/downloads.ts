// Downloads (D31): settings.json key `downloads`, unique save names, finished-notice text. Plain TS, no electron import.
import { readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { writeAtomic } from './atomic'

/** One finished download kept in downloads.json for the Settings list (UX-009). */
export interface DownloadEntry {
  path: string
  name: string
  time: number
  ok: boolean
}

export const DOWNLOAD_HISTORY_MAX = 20

/** A cancelled download is not history; otherwise the newest entry goes first and the list stays at 20. */
export function addDownload(list: DownloadEntry[], entry: DownloadEntry & { cancelled?: boolean }): DownloadEntry[] {
  if (entry.cancelled) return list
  const clean: DownloadEntry = { path: entry.path, name: entry.name, time: entry.time, ok: entry.ok }
  return [clean, ...list].slice(0, DOWNLOAD_HISTORY_MAX)
}

/** The Clear list action. */
export function clearDownloads(): DownloadEntry[] {
  return []
}

/** Reads downloads.json; a missing or broken file, and old entries without the fields, load as an empty list. */
export function loadDownloadList(dir: string): DownloadEntry[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'downloads.json'), 'utf8'))
    if (!Array.isArray(raw)) return []
    const rows = raw.filter(
      (e): e is DownloadEntry =>
        !!e && typeof e === 'object' && typeof e.path === 'string' && typeof e.name === 'string' && typeof e.time === 'number' && typeof e.ok === 'boolean'
    )
    return rows.slice(0, DOWNLOAD_HISTORY_MAX)
  } catch {
    return []
  }
}

export function saveDownloadList(dir: string, list: DownloadEntry[]): void {
  writeAtomic(join(dir, 'downloads.json'), JSON.stringify(list, null, 2), undefined, 0o600)
}

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

/**
 * dir/name, or dir/name (1).ext, (2)... for the first one that does not exist and is not reserved by a download
 * that started a moment ago. The picked name is reserved in the shared set so two events cannot choose the same path.
 */
export function uniquePath(dir: string, name: string, exists: (path: string) => boolean, reserved?: Set<string>): string {
  const safe = safeName(name)
  const ext = extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let p = join(dir, safe)
  for (let n = 1; exists(p) || reserved?.has(p); n++) p = join(dir, `${stem} (${n})${ext}`)
  reserved?.add(p)
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
