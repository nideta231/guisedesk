// Shared Meta login (D36). Plain TS, no electron: the renderer reads this too.
import { presetFor } from './presets'

interface Shareable {
  id: string
  serviceId: string
  label: string
  shareWith?: string
}

const isMeta = (serviceId: string) => presetFor(serviceId)?.family === 'meta'

/** Folder name under Partitions/ for this account: the host's id when it shares a login, else its own. */
export const partitionKey = (a: { id: string; shareWith?: string }): string => a.shareWith ?? a.id

/** The one place a session partition name is built. */
export const partitionOf = (a: { id: string; shareWith?: string }): string => `persist:${partitionKey(a)}`

/** Accounts a new account of this service may share a login with: other Meta services, and not themselves sharers. */
export function shareHosts<T extends Shareable>(serviceId: string, accounts: T[]): T[] {
  if (!isMeta(serviceId)) return []
  return accounts.filter((a) => isMeta(a.serviceId) && a.serviceId !== serviceId && !a.shareWith)
}

/** Threads starts as "Same as" the first Instagram account; everything else starts Separate. */
export function defaultShare(serviceId: string, accounts: Shareable[]): string | undefined {
  if (serviceId !== 'threads') return undefined
  return shareHosts(serviceId, accounts).find((a) => a.serviceId === 'instagram')?.id
}

/** Every account whose session is this account's partition (itself included). */
export const onPartition = <T extends { id: string; shareWith?: string }>(a: { id: string; shareWith?: string }, accounts: T[]): T[] =>
  accounts.filter((x) => partitionKey(x) === partitionKey(a))

/** Closes the popups of the host and every account sharing its login, so none stays over wiped storage. */
export function closePartitionPopups<T extends { id: string; shareWith?: string }>(
  a: { id: string; shareWith?: string },
  accounts: T[],
  closeFor: (id: string) => void
): void {
  for (const x of onPartition(a, accounts)) closeFor(x.id)
}
