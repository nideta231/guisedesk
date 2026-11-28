// Favicon for Custom URL accounts: one request to the site, cached under <data dir>/icons. No electron imports.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic, type Fs } from './atomic'

export type Fetcher = (url: string) => Promise<{ contentType: string; bytes: Uint8Array } | null>

const EXT: Record<string, string> = { png: 'png', 'svg+xml': 'svg', gif: 'gif', jpeg: 'jpg', webp: 'webp' }
const MIME: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' }
const extOf = (contentType: string) => EXT[contentType.split(';')[0].trim().replace('image/', '')] ?? 'ico'

/** Returns the icon path relative to the data dir (icons/<host>.<ext>), or undefined to fall back to initials. */
export async function cacheFavicon(dir: string, siteUrl: string, fetcher: Fetcher, fs?: Fs): Promise<string | undefined> {
  const { hostname, origin } = new URL(siteUrl)
  for (const ext of Object.keys(MIME)) {
    const rel = `icons/${hostname}.${ext}`
    if (existsSync(join(dir, rel))) return rel
  }
  try {
    const res = await fetcher(`${origin}/favicon.ico`)
    if (!res || res.bytes.length === 0 || !res.contentType.startsWith('image/')) return undefined
    const rel = `icons/${hostname}.${extOf(res.contentType)}`
    mkdirSync(join(dir, 'icons'), { recursive: true })
    writeAtomic(join(dir, rel), res.bytes, fs)
    return rel
  } catch {
    return undefined
  }
}

/** Data URL for a cached icon (the renderer cannot read the data dir). Only icons/<file> paths are read. */
export function readIcon(dir: string, rel?: string): string | undefined {
  const m = rel && /^icons\/[\w.-]+\.(\w+)$/.exec(rel)
  if (!m || rel.includes('..')) return undefined
  try {
    return `data:${MIME[m[1]] ?? 'image/x-icon'};base64,${readFileSync(join(dir, rel)).toString('base64')}`
  } catch {
    return undefined
  }
}
