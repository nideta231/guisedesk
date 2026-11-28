// Settings > Services logic (D6, D7). Plain TS, shared with the renderer: no fs, no electron.
import { limitMinutes } from './hibernate'
import { CUSTOM_PRESET_ID, kindOf, PRESETS, presetFor } from './presets'

interface Acc {
  id: string
  serviceId: string
  order?: number
  idlePolicy?: string
  muted?: boolean
}

export interface ServiceRow {
  id: string
  name: string
  count: number
  on: boolean
  summary: string
}

/** Accounts whose service is on: what the sidebar shows. */
export function visibleAccounts<T extends { serviceId: string }>(accounts: T[], disabled: string[]): T[] {
  return accounts.filter((a) => !disabled.includes(a.serviceId))
}

/** Accounts of a switched-off service: their pages are unloaded, but their partitions (and logins) stay. */
export function accountsToUnload<T extends { id: string; serviceId: string }>(accounts: T[], disabled: Iterable<string>): string[] {
  const off = new Set(disabled)
  return accounts.filter((a) => off.has(a.serviceId)).map((a) => a.id)
}

/** The sidebar's two groups, Chats then Feeds, each sorted by `order`. One source for the sidebar and the keyboard switch (D33). */
export function sidebarGroups<T extends { serviceId: string; order: number }>(accounts: T[]): { title: string; rows: T[] }[] {
  const sorted = [...accounts].sort((a, b) => a.order - b.order)
  return [
    { title: 'Chats', rows: sorted.filter((a) => kindOf(a.serviceId) === 'chat') },
    { title: 'Feeds', rows: sorted.filter((a) => kindOf(a.serviceId) === 'feed') }
  ]
}

/** Accounts flat in sidebar order. */
export const sidebarOrder = <T extends { serviceId: string; order: number }>(accounts: T[]): T[] => sidebarGroups(accounts).flatMap((g) => g.rows)

function summary(rows: Acc[], on: boolean): string {
  if (!on) return 'Off · hidden from the sidebar, still logged in'
  if (!rows.length) return 'No accounts'
  const parts = [`${rows.length} account${rows.length === 1 ? '' : 's'}`]
  const limits = new Set(rows.map((a) => limitMinutes(a)))
  if (limits.size > 1) parts.push('custom sleep settings')
  else {
    const m = [...limits][0]
    parts.push(m === null ? 'always on' : `sleeps after ${m === 60 ? '1 hour' : `${m} min`}`)
  }
  if (rows.every((a) => a.muted)) parts.push('muted')
  return parts.join(' · ')
}

/** Services for the Settings list, grouped by kind. Custom sites get a row only once there is one. */
export function serviceGroups(accounts: Acc[], disabled: string[]): { title: string; rows: ServiceRow[] }[] {
  const ids = [...PRESETS.map((p) => p.id), ...(accounts.some((a) => a.serviceId === CUSTOM_PRESET_ID) ? [CUSTOM_PRESET_ID] : [])]
  const rows = ids.map((id) => {
    const mine = accounts.filter((a) => a.serviceId === id)
    const on = !disabled.includes(id)
    return { id, name: presetFor(id)?.name ?? 'Custom sites', count: mine.length, on, summary: summary(mine, on) }
  })
  return [
    { title: 'Chats', rows: rows.filter((r) => kindOf(r.id) === 'chat') },
    { title: 'Feeds', rows: rows.filter((r) => kindOf(r.id) === 'feed') }
  ]
}

/** The sheet's four choices: stored idlePolicy value and label. */
export const SLEEP_CHOICES = [
  { value: 'always', label: 'Always on' },
  { value: '30', label: 'Sleep after 30 min' },
  { value: '10', label: '10 min' },
  { value: '60', label: '1 hour' }
]

/** Which choice is in force for an account (the default depends on its kind). */
export function effectiveChoice(a: Acc): string {
  const m = limitMinutes(a)
  return m === null ? 'always' : String(m)
}
