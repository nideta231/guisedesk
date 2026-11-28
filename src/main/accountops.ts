// Log out and Remove for one account (D6). Plain TS: Electron work (sessions, views) is passed in.
import { join } from 'node:path'
import { loadAccounts, saveAccounts } from './accounts'
import { wipeFiles } from './reset'
import { onPartition, partitionKey } from './sharing'

export interface AccountOpsDeps {
  /** Clear the cookies, storage and cache of one partition (named by partitionKey: the host's id when a login is shared). */
  clearStorage(key: string): Promise<void>
  /** Destroy the account's live view, if any. */
  closeView(id: string): void
  /** Send the account's live view (if any) back to its start page. */
  reloadView(id: string): void
}

/** Log out: clears that partition's storage once, keeps the account; every account on that partition reloads (D36). False when the id is unknown. */
export async function logOut(dir: string, id: string, deps: AccountOpsDeps): Promise<boolean> {
  const accounts = loadAccounts(dir)
  const a = accounts.find((x) => x.id === id)
  if (!a) return false
  await deps.clearStorage(partitionKey(a))
  for (const x of onPartition(a, accounts)) deps.reloadView(x.id)
  return true
}

/** Remove: destroys the view, clears storage, deletes the account and its partition dir (only that one, inside dir). */
export async function removeAccount(dir: string, id: string, deps: AccountOpsDeps): Promise<boolean> {
  // The id and the key it resolves to become path segments: plain names only, so they can never reach outside Partitions/.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('refusing an account id that is not a plain name')
  const accounts = loadAccounts(dir)
  const a = accounts.find((x) => x.id === id)
  if (!a) return false
  const key = partitionKey(a)
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('refusing an account id that is not a plain name')
  deps.closeView(id)
  const rest = accounts.filter((x) => x.id !== id)
  // A partition other accounts still use (a shared login, D36) keeps its storage and files.
  const inUse = rest.some((x) => partitionKey(x) === key)
  if (!inUse) await deps.clearStorage(key)
  saveAccounts(dir, rest)
  if (!inUse) wipeFiles(dir, [join(dir, 'Partitions', key)])
  return true
}
