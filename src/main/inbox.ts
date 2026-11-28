// Notification inbox (D64). Plain TS: no electron or node imports, so the renderer and vitest share it.
// Every page notification is kept here, muted ones included; bodies are dropped while the app is locked.
export interface InboxEvent {
  accountId: string
  title: string
  body?: string
}

export interface InboxItem {
  id: string
  accountId: string
  title: string
  body: string
  /** Epoch milliseconds. */
  time: number
  read: boolean
}

export const MAX_INBOX = 200

/** One stored notification. Locked: the sender and the body stay out of the file, like the native rule (D16, D64). */
export function inboxItem(event: InboxEvent, opts: { id: string; time: number; locked: boolean }): InboxItem {
  return {
    id: opts.id,
    accountId: event.accountId,
    title: opts.locked ? 'GuiseDesk' : event.title,
    body: opts.locked ? '' : event.body ?? '',
    time: opts.time,
    read: false
  }
}

/** Newest first, without touching the input. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => b.time - a.time)
}

/** Adds one item and keeps only the newest `max`. */
export function addInbox(items: InboxItem[], item: InboxItem, max = MAX_INBOX): InboxItem[] {
  return sortInbox([item, ...items]).slice(0, max)
}

export function markRead(items: InboxItem[], id: string): InboxItem[] {
  return items.map((i) => (i.id === id && !i.read ? { ...i, read: true } : i))
}

export function markAllRead(items: InboxItem[]): InboxItem[] {
  return items.map((i) => (i.read ? i : { ...i, read: true }))
}

/** Unread items whose account is not muted (D19, D64). */
export function unreadCount(items: InboxItem[], mutedIds: Iterable<string>): number {
  const muted = new Set(mutedIds)
  return items.filter((i) => !i.read && !muted.has(i.accountId)).length
}

export function filterInbox(items: InboxItem[], accountId?: string): InboxItem[] {
  return accountId ? items.filter((i) => i.accountId === accountId) : items
}

/** Text search (UX-020): every whitespace token must appear in the title, body or account label, case-insensitively. */
export function searchInbox(items: InboxItem[], query: string, labels: Record<string, string> = {}): InboxItem[] {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return items
  return items.filter((i) => {
    const text = `${i.title} ${i.body} ${labels[i.accountId] ?? ''}`.toLowerCase()
    return tokens.every((t) => text.includes(t))
  })
}

function validItem(v: unknown): v is InboxItem {
  if (!v || typeof v !== 'object') return false
  const i = v as Partial<InboxItem>
  return (
    typeof i.id === 'string' && i.id.length > 0 &&
    typeof i.accountId === 'string' && i.accountId.length > 0 &&
    typeof i.title === 'string' &&
    typeof i.body === 'string' &&
    typeof i.time === 'number' && Number.isFinite(i.time) && i.time > 0 &&
    typeof i.read === 'boolean'
  )
}

/** Safe read of inbox.json (an array or { v: 1, items }): drops bad rows, sorts newest first and caps at `max`. */
export function normalizeInbox(value: unknown, max = MAX_INBOX): InboxItem[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : []
  return sortInbox(raw.filter(validItem)).slice(0, max)
}

export interface InboxGroup {
  title: string
  items: InboxItem[]
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const dayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function dayTitle(day: number, now: Date): string {
  const today = startOfDay(now)
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  return dayFormatter.format(new Date(day))
}

/** Newest first, grouped by local calendar day. */
export function groupInbox(items: InboxItem[], now: Date = new Date()): InboxGroup[] {
  const groups: InboxGroup[] = []
  let current: InboxGroup | undefined
  for (const item of sortInbox(items)) {
    const day = startOfDay(new Date(item.time))
    if (!current || startOfDay(new Date(current.items[0].time)) !== day) {
      current = { title: dayTitle(day, now), items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}
