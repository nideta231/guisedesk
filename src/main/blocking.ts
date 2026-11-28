// Ad and pop-up blocking (D45): settings.json key `blocking`, and the pop-up rule (D37 amendment). Plain TS, no electron import.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './atomic'

export interface BlockingSettings {
  /** Block ad and tracker requests and hide ad slots (filter lists), in every service view and popup. Off by default. */
  ads: boolean
  /** Drop windows a page opens on its own, without a click or key press just before. On by default. */
  popups: boolean
}

/** A window.open counts as user-made when a click, tap or key press came at most this long before (ms). */
export const GESTURE_MS = 5000

/** Filter lists are re-downloaded when the cached engine is older than this (ms). */
export const ENGINE_MAX_AGE = 7 * 24 * 3600_000

/** Sign-in pop-ups are never dropped: host (any subdomain too) and an optional path prefix. */
export const SIGN_IN: { host: string; path?: string }[] = [
  { host: 'accounts.google.com' },
  { host: 'appleid.apple.com' },
  { host: 'login.microsoftonline.com' },
  { host: 'facebook.com', path: '/dialog' }
]

function readAll(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

/** Ads on only when explicitly true; pop-ups off only when explicitly false. */
export function loadBlocking(dir: string): BlockingSettings {
  const b = readAll(dir).blocking as { ads?: unknown; popups?: unknown } | undefined
  return { ads: b?.ads === true, popups: b?.popups !== false }
}

export function saveBlocking(dir: string, value: BlockingSettings): void {
  const blocking: BlockingSettings = { ads: value.ads === true, popups: value.popups === true }
  writeAtomic(join(dir, 'settings.json'), JSON.stringify({ ...readAll(dir), blocking }, null, 2), undefined, 0o600)
}

/** Input types that count as the user asking for a new window. */
export function isGesture(type: string): boolean {
  return ['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'gestureTap', 'touchStart', 'touchEnd', 'pointerDown', 'pointerUp'].includes(type)
}

/** A sign-in page from SIGN_IN over https, on the host or a subdomain (www.facebook.com/dialog/oauth). */
export function isSignIn(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return SIGN_IN.some(
    (s) => (u.hostname === s.host || u.hostname.endsWith('.' + s.host)) && (!s.path || u.pathname === s.path || u.pathname.startsWith(s.path + '/'))
  )
}

/**
 * The pop-up rule (D45, D37 amendment). Allowed: blocking off; a middle-click or Ctrl+click on a link (Chromium gives
 * background-tab only for those, never for a script's window.open); a sign-in page; a click, tap or key press at most
 * GESTURE_MS before. Anything else is dropped.
 */
export function popupBlocked(s: { on: boolean; now: number; lastGesture: number | undefined; disposition?: string; url?: string }): boolean {
  if (!s.on) return false
  if (s.disposition === 'background-tab') return false
  if (s.url && isSignIn(s.url)) return false
  return s.lastGesture === undefined || s.now - s.lastGesture > GESTURE_MS
}

/** Log line for a dropped pop-up: the URL and the age of the last gesture. */
export function blockedLine(url: string, now: number, lastGesture: number | undefined): string {
  const age = lastGesture === undefined ? 'no gesture' : `last gesture ${((now - lastGesture) / 1000).toFixed(1)}s ago`
  return `[guisedesk] pop-up blocked: ${url} (${age})`
}

/** The cached engine file is usable when it exists and is younger than ENGINE_MAX_AGE. */
export function engineFresh(mtimeMs: number | undefined, now: number): boolean {
  return mtimeMs !== undefined && now - mtimeMs < ENGINE_MAX_AGE
}
