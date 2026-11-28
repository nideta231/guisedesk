// Favicon for Custom URL accounts: one request to the site, cached under <data dir>/icons. No electron imports.
import { existsSync, mkdirSync } from 'node:fs'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { writeAtomic, type Fs } from './atomic'

export type Fetcher = (url: string) => Promise<{ contentType: string; bytes: Uint8Array } | null>

export interface IconReader {
  readFileSync(path: string): Buffer | string
  statSync(path: string): { mtimeMs: number }
}

const EXT: Record<string, string> = { png: 'png', 'svg+xml': 'svg', gif: 'gif', jpeg: 'jpg', webp: 'webp' }
const MIME: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' }
// Decoded data URLs, keyed by full path and checked against the file's mtime: snapshots ask for the same few icons often.
const iconCache = new Map<string, { mtimeMs: number; url: string }>()
const extOf = (contentType: string) => EXT[contentType.split(';')[0].trim().replace('image/', '')] ?? 'ico'
/** A hostname safe for a file name: an IPv6 host comes from URL as [::1], which readIcon would reject. */
const slugHost = (hostname: string) => hostname.replace(/[^A-Za-z0-9.-]/g, '_')

/** Returns the icon path relative to the data dir (icons/<host>.<ext>), or undefined to fall back to initials. */
export async function cacheFavicon(dir: string, siteUrl: string, fetcher: Fetcher, fs?: Fs): Promise<string | undefined> {
  const { hostname, origin } = new URL(siteUrl)
  const host = slugHost(hostname)
  for (const ext of Object.keys(MIME)) {
    const rel = `icons/${host}.${ext}`
    if (existsSync(join(dir, rel))) return rel
  }
  try {
    const res = await fetcher(`${origin}/favicon.ico`)
    if (!res || res.bytes.length === 0 || !res.contentType.startsWith('image/')) return undefined
    const rel = `icons/${host}.${extOf(res.contentType)}`
    mkdirSync(join(dir, 'icons'), { recursive: true })
    writeAtomic(join(dir, rel), res.bytes, fs)
    iconCache.delete(join(dir, rel))
    return rel
  } catch {
    return undefined
  }
}

/** Data URL for a cached icon (the renderer cannot read the data dir). Only icons/<file> paths are read. */
export function readIcon(dir: string, rel?: string, fs: IconReader = nodeFs): string | undefined {
  const m = rel && /^icons\/[\w.-]+\.(\w+)$/.exec(rel)
  if (!m || rel!.includes('..')) return undefined
  const full = join(dir, rel!)
  try {
    const st = fs.statSync(full)
    const hit = iconCache.get(full)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.url
    const url = `data:${MIME[m[1]] ?? 'image/x-icon'};base64,${fs.readFileSync(full).toString('base64')}`
    iconCache.set(full, { mtimeMs: st.mtimeMs, url })
    return url
  } catch {
    return undefined
  }
}
