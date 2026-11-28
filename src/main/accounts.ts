import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic, type Fs } from './atomic'
import { appendEvent } from './events'
import { PARTS, type Part } from '../preload/blur'
import { clampSplit } from './layout'
import { checkShare, validateNewAccount, type NewAccountInput } from './validate'
import type { ProxyCredential } from './proxy'

export interface Account {
  id: string
  serviceId: string
  label: string
  colour: string
  order: number
  idlePolicy?: string
  muted?: boolean
  /** Blur media in the service view until hovered (D42, D43). */
  blurMedia?: boolean
  /** WhatsApp privacy blur parts (D48); a missing flag means on. */
  blurParts?: Partial<Record<Part, boolean>>
  /** Keep the text of messages deleted for everyone (WhatsApp only, D47b). */
  keepDeleted?: boolean
  /** Chrome extension ids turned on for this account (D49). */
  extensions?: string[]
  /** Chromium zoom level (D32); missing = 0 (100%). */
  zoom?: number
  /** Host account id whose session partition this account uses (D36). */
  shareWith?: string
  /** Proxy address for this account's partition (D63), without credentials: `socks5://host:1080`. */
  proxy?: string
  custom?: { name: string; url: string; hosts: string[]; icon?: string }
}

const file = (dir: string) => join(dir, 'accounts.json')

/** Account ids become partition names and paths, so only plain names are allowed. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/

/**
 * Keeps only usable rows, gives a missing order its array index and drops duplicate ids. Unknown keys stay on valid rows.
 * `dir` lets a shareWith point at a partition that still exists (removing a host keeps it for the accounts sharing it).
 */
function sanitizeAccounts(dir: string, rows: unknown[]): { accounts: Account[]; dropped: number } {
  const seen = new Set<string>()
  const kept: { row: Record<string, unknown>; index: number }[] = []
  let dropped = 0
  for (let index = 0; index < rows.length; index++) {
    const r = rows[index]
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      dropped++
      continue
    }
    const row = r as Record<string, unknown>
    if (typeof row.id !== 'string' || !PLAIN_ID.test(row.id) || typeof row.serviceId !== 'string' || typeof row.label !== 'string' || typeof row.colour !== 'string' || seen.has(row.id)) {
      dropped++
      continue
    }
    seen.add(row.id)
    kept.push({ row, index })
  }
  // A shared login must point at a plain id: one in the file, or a partition it left behind for its sharers.
  const known = (id: string) => seen.has(id) || existsSync(join(dir, 'Partitions', id))
  const valid = kept.filter(({ row }) => row.shareWith === undefined || (typeof row.shareWith === 'string' && PLAIN_ID.test(row.shareWith) && known(row.shareWith)))
  dropped += kept.length - valid.length
  const accounts = valid.map(({ row, index }) => ({
    ...(row as unknown as Account),
    order: typeof row.order === 'number' && Number.isFinite(row.order) ? row.order : index
  }))
  return { accounts, dropped }
}

export function loadAccounts(dir: string): Account[] {
  try {
    const data = JSON.parse(readFileSync(file(dir), 'utf8'))
    if (!Array.isArray(data)) return []
    const { accounts, dropped } = sanitizeAccounts(dir, data)
    if (dropped) appendEvent(dir, `accounts.json: dropped ${dropped} invalid row${dropped === 1 ? '' : 's'}`)
    return accounts
  } catch {
    return []
  }
}

export function saveAccounts(dir: string, accounts: Account[], fs?: Fs): void {
  writeAtomic(file(dir), JSON.stringify(accounts, null, 2), fs)
}

export function orderedAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => a.order - b.order)
}

/** Validates (throws Error with the message to show), trims, and appends. icon: cached favicon path for a custom site. */
export function addAccount(dir: string, input: NewAccountInput, icon?: string): Account {
  const v = validateNewAccount(input)
  if (!v.ok) throw new Error(v.error)
  const accounts = loadAccounts(dir)
  const bad = checkShare(v.value.serviceId, v.value.shareWith, accounts)
  if (bad) throw new Error(bad)
  const order = accounts.reduce((m, a) => Math.max(m, a.order + 1), 0)
  const { custom, ...rest } = v.value
  const account: Account = {
    id: randomBytes(8).toString('hex'),
    ...rest,
    ...(custom ? { custom: icon ? { ...custom, icon } : custom } : {}),
    order,
    idlePolicy: 'default',
    muted: false
  }
  saveAccounts(dir, [...accounts, account])
  return account
}

/** Selected account is remembered in settings.json (key selectedAccount). */
export function loadSelected(dir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).selectedAccount
  } catch {
    return undefined
  }
}

export function saveSelected(dir: string, id: string): void {
  updateSettings(dir, { selectedAccount: id })
}

/** Account colours are plain six-digit CSS hex values (UX-016). */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/i

/**
 * Renames and recolours an existing account (UX-016). An empty label, a colour that is not #rrggbb or an unknown id
 * leaves accounts.json untouched; `changed` says whether it was written.
 */
export function editAccount(dir: string, id: unknown, label: unknown, colour: unknown): { changed: boolean; accounts: Account[] } {
  const accounts = loadAccounts(dir)
  const clean = typeof label === 'string' ? label.trim() : ''
  if (!clean || typeof colour !== 'string' || !HEX_COLOUR.test(colour) || typeof id !== 'string' || !accounts.some((a) => a.id === id)) {
    return { changed: false, accounts }
  }
  const next = accounts.map((a) => (a.id === id ? { ...a, label: clean, colour: colour.toLowerCase() } : a))
  saveAccounts(dir, next)
  return { changed: true, accounts: next }
}

/** Sets one account's muted flag (D19) and returns the saved list. */
export function setMuted(dir: string, id: string, muted: boolean): Account[] {
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, muted } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one account's blur-media flag (D42) and returns the saved list. */
export function setBlurMedia(dir: string, id: string, blurMedia: boolean): Account[] {
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, blurMedia } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one WhatsApp blur part flag (D48) and returns the saved list. */
export function setBlurPart(dir: string, id: string, part: Part, on: boolean): Account[] {
  if (!PARTS.includes(part)) throw new Error('Unknown blur part')
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, blurParts: { ...a.blurParts, [part]: on } } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one account's keep-deleted-messages flag (D47b) and returns the saved list. */
export function setKeepDeleted(dir: string, id: string, keepDeleted: boolean): Account[] {
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, keepDeleted } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one account's Chrome extension list (D49) and returns the saved list. */
export function setExtensions(dir: string, id: string, extensions: string[]): Account[] {
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, extensions } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one account's proxy address (D63); undefined removes it (Direct). Returns the saved list. */
export function setAccountProxy(dir: string, id: string, proxy: string | undefined): Account[] {
  const accounts = loadAccounts(dir).map((a) => {
    if (a.id !== id) return a
    const { proxy: _old, ...rest } = a
    return proxy ? { ...rest, proxy } : rest
  })
  saveAccounts(dir, accounts)
  return accounts
}

/** Proxy sign-in per partition (D63) in settings.json key proxyAuth; passwords never go to accounts.json or logs. */
export function loadProxyAuth(dir: string): Record<string, ProxyCredential> {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).proxyAuth
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, ProxyCredential> = {}
    for (const [key, x] of Object.entries(v as Record<string, unknown>)) {
      const c = x as { username?: unknown; password?: unknown } | null
      if (c && typeof c.username === 'string' && typeof c.password === 'string') out[key] = { username: c.username, password: c.password }
    }
    return out
  } catch {
    return {}
  }
}

/** Saves or removes the proxy sign-in for one partition (D63). */
export function saveProxyAuth(dir: string, key: string, auth: ProxyCredential | undefined): void {
  const all = loadProxyAuth(dir)
  if (auth) all[key] = auth
  else delete all[key]
  updateSettings(dir, { proxyAuth: Object.keys(all).length ? all : undefined })
}

/** Global Do Not Disturb (D19) lives in settings.json (key dnd); off when missing. */
export function loadDnd(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).dnd === true
  } catch {
    return false
  }
}

export function saveDnd(dir: string, dnd: boolean): void {
  updateSettings(dir, { dnd })
}

/** Quiet outside work hours (D58) lives in settings.json key quietWorkHours; off when missing. */
export function loadQuietWorkHours(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).quietWorkHours === true
  } catch {
    return false
  }
}

export function saveQuietWorkHours(dir: string, on: boolean): void {
  updateSettings(dir, { quietWorkHours: on })
}

/** Collapsed sidebar rail (D24) lives in settings.json key sidebarCollapsed; expanded when missing. */
export function loadSidebarCollapsed(dir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).sidebarCollapsed === true
  } catch {
    return false
  }
}

/** Sidebar width and hidden state (D52) in settings.json: sidebarWidth (px), sidebarHidden. */
export function loadSidebarLayout(dir: string): { width: number; hidden: boolean } {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    return { width: typeof s.sidebarWidth === 'number' ? s.sidebarWidth : 232, hidden: s.sidebarHidden === true }
  } catch {
    return { width: 232, hidden: false }
  }
}

export function saveSidebarLayout(dir: string, v: { width: number; hidden: boolean }): void {
  updateSettings(dir, { sidebarWidth: v.width, sidebarHidden: v.hidden })
}

export function saveSidebarCollapsed(dir: string, sidebarCollapsed: boolean): void {
  updateSettings(dir, { sidebarCollapsed })
}

/** Split view (D62) in settings.json key split: the two account ids and the divider ratio. */
export interface SplitState {
  a: string
  b: string
  ratio: number
}

export function loadSplit(dir: string): SplitState | undefined {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).split
    if (!v || typeof v.a !== 'string' || typeof v.b !== 'string' || !v.a || !v.b || v.a === v.b) return undefined
    return { a: v.a, b: v.b, ratio: clampSplit(v.ratio) }
  } catch {
    return undefined
  }
}

export function saveSplit(dir: string, split: SplitState | undefined): void {
  updateSettings(dir, { split })
}

/** Idle lock minutes (D15, D17) in settings.json key idleLock: 5, 10, 30 or 'manual'; 10 when missing or invalid. */
export function loadIdleMinutes(dir: string): 5 | 10 | 30 | 'manual' {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).idleLock
    return v === 5 || v === 10 || v === 30 || v === 'manual' ? v : 10
  } catch {
    return 10
  }
}

import { normalizeSchedule, type LockSchedule } from './schedule'

/** Lock schedule (D51) in settings.json key lockSchedule; off with defaults when missing. */
export function loadSchedule(dir: string): LockSchedule {
  try {
    return normalizeSchedule(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).lockSchedule)
  } catch {
    return normalizeSchedule(undefined)
  }
}

export function saveSchedule(dir: string, s: LockSchedule): void {
  updateSettings(dir, { lockSchedule: s })
}

export function saveIdleMinutes(dir: string, minutes: 5 | 10 | 30 | 'manual'): void {
  updateSettings(dir, { idleLock: minutes })
}

function updateSettings(dir: string, patch: Record<string, unknown>): void {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  } catch {
    /* first write */
  }
  // settings.json holds proxy passwords, so every write keeps it readable by the user only (D63).
  writeAtomic(join(dir, 'settings.json'), JSON.stringify({ ...settings, ...patch }, null, 2), undefined, 0o600)
}

/** Services switched off in Settings (D6), in settings.json key disabledServices. Accounts and sessions stay. */
export function loadDisabled(dir: string): string[] {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).disabledServices
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function setServiceEnabled(dir: string, serviceId: string, enabled: boolean): string[] {
  const off = loadDisabled(dir).filter((s) => s !== serviceId)
  if (!enabled) off.push(serviceId)
  updateSettings(dir, { disabledServices: off })
  return off
}

export const IDLE_POLICIES = ['default', 'always', '10', '30', '60']

/** Sets one account's hibernation override (D7); throws on a value outside IDLE_POLICIES. */
export function setIdlePolicy(dir: string, id: string, policy: string): Account[] {
  if (!IDLE_POLICIES.includes(policy)) throw new Error('Unknown sleep setting')
  const accounts = loadAccounts(dir).map((a) => (a.id === id ? { ...a, idlePolicy: policy } : a))
  saveAccounts(dir, accounts)
  return accounts
}

/** Drag reorder (D28): rewrites order 0..n-1 by the listed ids; unlisted accounts follow in their old order. Throws on an unknown or duplicate id. */
export function reorderAccounts(dir: string, ids: string[]): Account[] {
  const all = orderedAccounts(loadAccounts(dir))
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate account id')
  if (ids.some((id) => !all.some((a) => a.id === id))) throw new Error('Unknown account id')
  const listed = ids.map((id) => all.find((a) => a.id === id)!)
  const accounts = [...listed, ...all.filter((a) => !ids.includes(a.id))].map((a, order) => ({ ...a, order }))
  saveAccounts(dir, accounts)
  return accounts
}

/** Sets one account's zoom level (D32); 0 removes the key. Returns the saved list. */
export function setZoom(dir: string, id: string, level: number): Account[] {
  const accounts = loadAccounts(dir).map((a) => {
    if (a.id !== id) return a
    const { zoom: _old, ...rest } = a
    return level === 0 ? rest : { ...rest, zoom: level }
  })
  saveAccounts(dir, accounts)
  return accounts
}
