// Notification inbox storage (D64): <data>/inbox.json through writeAtomic. Main process only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './atomic'
import { normalizeInbox, type InboxItem } from './inbox'

export function loadInbox(dir: string): InboxItem[] {
  try {
    return normalizeInbox(JSON.parse(readFileSync(join(dir, 'inbox.json'), 'utf8')))
  } catch {
    return []
  }
}

export function saveInbox(dir: string, items: InboxItem[]): void {
  // Notification text is personal, so inbox.json is readable by the user only.
  writeAtomic(join(dir, 'inbox.json'), JSON.stringify({ v: 1, items: normalizeInbox(items) }, null, 2), undefined, 0o600)
}

/**
 * Debounced inbox writer: the in-memory list stays authoritative and a burst of notifications becomes one disk write.
 * flush() writes the latest list now (quit, lock, reset); cancel() drops an unsaved change (reset wiped the file).
 */
export interface InboxSaver {
  save(items: InboxItem[]): void
  flush(): void
  cancel(): void
}

export function createInboxSaver(write: (items: InboxItem[]) => void, delayMs = 1000): InboxSaver {
  let pending: InboxItem[] | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!pending) return
    const items = pending
    pending = undefined
    write(items)
  }
  return {
    save(items: InboxItem[]): void {
      pending = items
      if (timer !== undefined) return
      timer = setTimeout(run, delayMs)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    },
    flush: run,
    cancel(): void {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      pending = undefined
    }
  }
}
