// Links to another service (D40): which accounts can open an external link. Plain TS, no electron.
import { unwrap } from './links'
import { presetFor } from './presets'
import { sidebarOrder } from './services'
import { partitionKey } from './sharing'

interface Acc {
  id: string
  shareWith?: string
  serviceId: string
  order: number
  custom?: { hosts: string[] }
}

/** Hosts that count as the account's own service (preset home hosts, or a custom site's hosts). */
export const homesOf = (a: Acc): string[] => presetFor(a.serviceId)?.homeHosts ?? a.custom?.hosts ?? []

/** Accounts (enabled services only, in sidebar order) whose service has the link's host as a home host or subdomain of one. */
export function candidatesFor<T extends Acc>(url: string, accounts: T[], disabled: string[]): T[] {
  let u: URL
  try {
    u = new URL(unwrap(url))
  } catch {
    return []
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return []
  const host = u.hostname.toLowerCase()
  return sidebarOrder(accounts.filter((a) => !disabled.includes(a.serviceId))).filter((a) =>
    homesOf(a).some((h) => host === h || host.endsWith('.' + h))
  )
}

/** Other enabled accounts of this account's service on a different session partition, in sidebar order (D46). */
export function siblingsFor<T extends Acc>(account: T, accounts: T[], disabled: string[]): T[] {
  if (disabled.includes(account.serviceId)) return []
  return sidebarOrder(accounts.filter((a) => a.serviceId === account.serviceId && partitionKey(a) !== partitionKey(account) && homesOf(a).join() === homesOf(account).join()))
}

/** A URL safe to load in another account's session: http(s) only, after unwrapping a redirect wrapper. */
export function safeWebUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(unwrap(url))
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** The URL "Open in another account" opens (D46): a home-host link, else the post under the cursor, else the page. */
export function pickTarget(linkURL: string, postURL: string | null | undefined, pageURL: string, homeHosts: string[]): string {
  try {
    const u = new URL(unwrap(linkURL))
    const h = u.hostname.toLowerCase()
    if ((u.protocol === 'http:' || u.protocol === 'https:') && homeHosts.some((x) => h === x || h.endsWith('.' + x))) return u.href
  } catch { /* not a URL */ }
  return postURL || pageURL
}
