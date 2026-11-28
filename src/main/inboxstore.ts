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
