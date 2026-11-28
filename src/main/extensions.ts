// Chrome extensions (D49). Installed once from a Chrome Web Store link into <data>/extensions, then turned on per
// account (Account.extensions). electron-chrome-extensions adds the chrome.tabs / windows / action APIs Electron lacks.
// Plain TS, no electron import.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './atomic'

export interface InstalledExtension {
  id: string
  name: string
  version: string
  path: string
}

/** A Chrome Web Store link (old or new store) or a bare 32-letter id, to the extension id; null when neither. */
export function parseExtensionId(input: string): string | null {
  const s = String(input ?? '').trim()
  if (/^[a-p]{32}$/.test(s)) return s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.hostname !== 'chromewebstore.google.com' && u.hostname !== 'chrome.google.com') return null
  const m = /\/([a-p]{32})(?:\/|$)/.exec(u.pathname)
  return m ? m[1] : null
}

/** The extension ids an account has on, limited to installed ones. */
export function enabledFor(a: { extensions?: string[] }, installed: string[]): string[] {
  return (a.extensions ?? []).filter((id) => installed.includes(id))
}

/** Returns the new list with id turned on or off (no duplicates, stable order). */
export function toggled(list: string[] | undefined, id: string, on: boolean): string[] {
  const rest = (list ?? []).filter((x) => x !== id)
  return on ? [...rest, id] : rest
}

export const extensionsDir = (dataDir: string) => join(dataDir, 'extensions')

/** Numeric version compare: >0 when a is newer. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

/** Chrome Web Store update service URL for one extension (D56). */
export function updateCheckUrl(id: string, chromeVersion: string): string {
  return `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=${encodeURIComponent(chromeVersion)}&acceptformat=crx2,crx3&x=${encodeURIComponent(`id=${id}&uc`)}`
}

/** The version in an update-check XML response (`<updatecheck ... version="1.2.3">`), or null. */
export function parseUpdateVersion(xml: string): string | null {
  const m = /<updatecheck\b[^>]*\bversion\s*=\s*["']([^"']+)["']/i.exec(String(xml ?? ''))
  return m && /^\d+(?:\.\d+)*$/.test(m[1]) ? m[1] : null
}

export interface ExtensionUpdate {
  id: string
  current: string
  version: string
}

/** Newer versions among the update-service answers, compared numerically. */
export function updatesFor(installed: InstalledExtension[], got: Record<string, string | null>): ExtensionUpdate[] {
  const out: ExtensionUpdate[] = []
  for (const x of installed) {
    const v = got[x.id]
    if (v && compareVersions(v.split('.').map(Number), x.version.split('.').map(Number)) > 0) out.push({ id: x.id, current: x.version, version: v })
  }
  return out
}

/** Checks every installed extension with the Chrome Web Store; the text fetcher is injected for tests. */
export async function checkExtensionUpdates(o: {
  installed: InstalledExtension[]
  chromeVersion: string
  fetchText: (url: string) => Promise<string>
}): Promise<ExtensionUpdate[]> {
  const got: Record<string, string | null> = {}
  await Promise.all(
    o.installed.map(async (x) => {
      try {
        got[x.id] = parseUpdateVersion(await o.fetchText(updateCheckUrl(x.id, o.chromeVersion)))
      } catch {
        got[x.id] = null
      }
    })
  )
  return updatesFor(o.installed, got)
}

const updateTimesFile = (dataDir: string) => join(dataDir, 'extension-updates.json')

/** Per-extension last-update dates (YYYY-MM-DD) for Settings > Extensions. */
export function loadUpdateTimes(dataDir: string): Record<string, string> {
  try {
    const v = JSON.parse(readFileSync(updateTimesFile(dataDir), 'utf8'))
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {}
  } catch {
    return {}
  }
}

export function saveUpdateTimes(dataDir: string, v: Record<string, string>): void {
  writeAtomic(updateTimesFile(dataDir), JSON.stringify(v, null, 2))
}

/**
 * The newest complete unpacked copy (<dir>/<id>/<version>_0 with a manifest.json), or null. Leftovers from an
 * interrupted install (temp uuid folders, version folders without a manifest) are removed so the next download can
 * rename into place (ENOTEMPTY otherwise).
 */
export function readyCopy(extDir: string, id: string): string | null {
  const root = join(extDir, id)
  if (!existsSync(root)) return null
  let best: { path: string; v: number[] } | null = null
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    const m = /^(\d+(?:\.\d+)*)_0$/.exec(name)
    if (!m || !existsSync(join(path, 'manifest.json'))) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    const v = m[1].split('.').map(Number)
    if (!best || compareVersions(v, best.v) > 0) best = { path, v }
  }
  return best?.path ?? null
}

/** Parsed manifest.json of an unpacked extension; {} when missing or unreadable. */
export function readManifest(path: string): Record<string, unknown> {
  try {
    const m = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'))
    return m && typeof m === 'object' ? m : {}
  } catch {
    return {}
  }
}

export type ActionClick = { kind: 'popup'; popup: string } | { kind: 'onClicked' }

/**
 * What a toolbar click does for this manifest (D54): open action.default_popup when the manifest has one, else
 * dispatch onClicked. MV3 reads `action`, MV2 `browser_action`; a malformed or missing action means onClicked.
 */
export function actionClick(manifest: unknown): ActionClick {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as {
    manifest_version?: unknown
    action?: { default_popup?: unknown }
    browser_action?: { default_popup?: unknown }
  }
  const action = m.manifest_version === 3 ? m.action : m.manifest_version === 2 ? m.browser_action : undefined
  const popup = action && typeof action === 'object' ? action.default_popup : undefined
  return typeof popup === 'string' && popup.trim() ? { kind: 'popup', popup: popup.trim() } : { kind: 'onClicked' }
}

/** Manifest name, resolving __MSG_key__ from _locales (default_locale, then en). */
export function manifestName(path: string): string {
  try {
    const m = readManifest(path)
    const raw = String(m.name ?? '')
    const key = /^__MSG_(.+)__$/.exec(raw)?.[1]
    if (!key) return raw
    for (const loc of [m.default_locale, 'en', 'en_US'].filter((x): x is string => typeof x === 'string' && !!x)) {
      try {
        const msgs = JSON.parse(readFileSync(join(path, '_locales', loc, 'messages.json'), 'utf8'))
        const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] as { message?: string } | undefined
        if (hit?.message) return hit.message
      } catch { /* next locale */ }
    }
    return key
  } catch {
    return ''
  }
}

/** Every installed extension (complete copies only), sorted by name. */
export function listInstalled(extDir: string): InstalledExtension[] {
  if (!existsSync(extDir)) return []
  const out: InstalledExtension[] = []
  for (const id of readdirSync(extDir)) {
    if (!/^[a-p]{32}$/.test(id)) continue
    const path = readyCopy(extDir, id)
    if (!path) continue
    out.push({ id, name: manifestName(path) || id, version: path.split('/').pop()!.replace(/_0$/, ''), path })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One download per extension at a time, shared by every caller: concurrent callers wait for the same promise.
 * download(id, extDir) unpacks into <extDir>/<id>/<version>_0 and returns that path. `force` skips the installed
 * copy, for an update check that already knows a newer version exists (D56). remove(id) tombstones a download that
 * is still running and deletes the folder again when it settles, so Remove during Add really removes it.
 */
export type ExtensionFetcher = ((id: string, force?: boolean) => Promise<string>) & { remove(id: string): Promise<void> }

export function createExtensionFetcher(extDir: string, download: (id: string, dir: string) => Promise<string>): ExtensionFetcher {
  const inFlight = new Map<string, Promise<string>>()
  const tombstones = new Set<string>()
  const fetch = ((id: string, force = false): Promise<string> => {
    if (tombstones.has(id)) return Promise.reject(new Error('the extension is being removed'))
    const ready = force || inFlight.has(id) ? null : readyCopy(extDir, id)
    if (ready) return Promise.resolve(ready)
    let p = inFlight.get(id)
    if (!p) {
      p = download(id, extDir).finally(() => inFlight.delete(id))
      inFlight.set(id, p)
    }
    return p
  }) as ExtensionFetcher
  fetch.remove = async (id: string): Promise<void> => {
    tombstones.add(id)
    const p = inFlight.get(id)
    if (p) {
      try {
        await p
      } catch {
        /* a failed download leaves nothing to keep */
      }
    }
    inFlight.delete(id)
    // The download may have renamed its temp folder into place after Remove began: delete the whole id again.
    rmSync(join(extDir, id), { recursive: true, force: true })
    tombstones.delete(id)
  }
  return fetch
}
