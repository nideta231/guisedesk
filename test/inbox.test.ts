import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  addInbox,
  filterInbox,
  groupInbox,
  inboxItem,
  markAllRead,
  markRead,
  markUnread,
  MAX_INBOX,
  normalizeInbox,
  searchInbox,
  unreadCount,
  type InboxItem
} from '../src/main/inbox'
import { createInboxSaver, loadInbox, saveInbox } from '../src/main/inboxstore'

const item = (id: string, time: number, opts: Partial<InboxItem> = {}): InboxItem => ({
  id,
  accountId: 'a1',
  title: 'Alice',
  body: 'Lunch at 12?',
  time,
  read: false,
  ...opts
})

describe('notification inbox (D64)', () => {
  it('keeps the newest first and caps the list at 200', () => {
    let items: InboxItem[] = []
    for (let i = 0; i < MAX_INBOX + 5; i++) items = addInbox(items, item(`i${i}`, 1000 + i))
    expect(items).toHaveLength(MAX_INBOX)
    expect(items[0].id).toBe(`i${MAX_INBOX + 4}`)
    expect(items[items.length - 1].id).toBe('i5')
  })

  it('stores the sender and body normally, but a locked item only has a generic title and no body', () => {
    expect(inboxItem({ accountId: 'a1', title: 'Alice', body: 'secret' }, { id: 'x', time: 5, locked: false })).toEqual({
      id: 'x',
      accountId: 'a1',
      title: 'Alice',
      body: 'secret',
      time: 5,
      read: false
    })
    const locked = inboxItem({ accountId: 'a1', title: 'Alice', body: 'secret' }, { id: 'y', time: 6, locked: true })
    expect(locked).toEqual({ id: 'y', accountId: 'a1', title: 'GuiseDesk', body: '', time: 6, read: false })
    expect(JSON.stringify(locked)).not.toContain('Alice')
    expect(JSON.stringify(locked)).not.toContain('secret')
  })

  it('marks one item read, or every item read, without touching the others', () => {
    const items = [item('a', 3), item('b', 2), item('c', 1)]
    expect(markRead(items, 'b').map((i) => i.read)).toEqual([false, true, false])
    expect(markRead(items, 'nope').map((i) => i.read)).toEqual([false, false, false])
    expect(markAllRead(items).every((i) => i.read)).toBe(true)
  })

  it('marks only the chosen read item unread again', () => {
    const items = [item('a', 3, { read: true }), item('b', 2, { read: true }), item('c', 1)]
    expect(markUnread(items, 'a').map((i) => i.read)).toEqual([false, true, false])
    expect(markUnread(items, 'c').map((i) => i.read)).toEqual([true, true, false])
    expect(markUnread(items, 'nope').map((i) => i.read)).toEqual([true, true, false])
  })

  it('counts unread items but not a muted account, and keeps muted items in the list', () => {
    const items = [item('a', 3), item('b', 2, { read: true }), item('c', 1, { accountId: 'a2' })]
    expect(unreadCount(items, [])).toBe(2)
    expect(unreadCount(items, ['a1'])).toBe(1)
    expect(filterInbox(items, 'a1')).toHaveLength(2)
    expect(filterInbox(items)).toHaveLength(3)
  })

  it('searches title, body and account label with ANDed case-insensitive tokens', () => {
    const items = [
      item('a', 3, { title: 'Alice', body: 'Lunch at 12?' }),
      item('b', 2, { accountId: 'a2', title: 'Ben', body: 'Standup' }),
      item('c', 1, { title: 'Old', body: 'Hello', read: true })
    ]
    expect(searchInbox(items, 'lunch').map((i) => i.id)).toEqual(['a'])
    expect(searchInbox(items, 'LUNCH Alice').map((i) => i.id)).toEqual(['a'])
    expect(searchInbox(items, 'lunch ben')).toEqual([])
    expect(searchInbox(items, 'Work', { a2: 'Work' }).map((i) => i.id)).toEqual(['b'])
    expect(searchInbox(items, '')).toBe(items)
    expect(searchInbox(items, '   ')).toBe(items)
  })

  it('drops malformed rows and accepts the stored { v, items } shape', () => {
    const good = item('good', 10)
    const value = normalizeInbox({ v: 1, items: [good, { ...good, id: '' }, { ...good, time: 'x' }, null] })
    expect(value).toEqual([good])
    expect(normalizeInbox('nope')).toEqual([])
    expect(normalizeInbox({ items: 'nope' })).toEqual([])
  })

  it('groups newest first by local day, with Today and Yesterday labels', () => {
    const now = new Date(2026, 10, 27, 12, 0)
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime()
    const groups = groupInbox([item('old', at(24, 9)), item('today', at(27, 8)), item('yesterday', at(26, 22)), item('today2', at(27, 10))], now)
    expect(groups.map((g) => g.title)).toEqual(['Today', 'Yesterday', 'Tue, 24 Nov 2026'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['today2', 'today'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['yesterday'])
  })

  it('round trips through inbox.json with writeAtomic data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-inbox-'))
    const items = [item('a', 2), item('b', 1, { read: true })]
    saveInbox(dir, items)
    expect(loadInbox(dir)).toEqual(items)
    expect(JSON.parse(readFileSync(join(dir, 'inbox.json'), 'utf8')).v).toBe(1)
    expect(statSync(join(dir, 'inbox.json')).mode & 0o777).toBe(0o600)
    writeFileSync(join(dir, 'inbox.json'), 'not json')
    expect(loadInbox(dir)).toEqual([])
  })
})

describe('inbox saver debounce', () => {
  it('turns a burst of five adds into one write after one second', () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      const saver = createInboxSaver(write)
      let items: InboxItem[] = []
      for (let i = 0; i < 5; i++) {
        items = addInbox(items, item(`i${i}`, 1000 + i))
        saver.save(items)
      }
      expect(write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(999)
      expect(write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(write).toHaveBeenCalledTimes(1)
      expect(write.mock.calls[0][0]).toHaveLength(5)
      expect(write.mock.calls[0][0][0].id).toBe('i4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush writes the latest list immediately and cancels the pending timer', () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      const saver = createInboxSaver(write)
      saver.save([item('a', 1)])
      saver.save([item('b', 2)])
      saver.flush()
      expect(write).toHaveBeenCalledTimes(1)
      expect(write.mock.calls[0][0][0].id).toBe('b')
      vi.advanceTimersByTime(5000)
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a flush with nothing pending writes nothing, and the 200-item cap still holds', () => {
    const write = vi.fn()
    const saver = createInboxSaver(write)
    saver.flush()
    expect(write).not.toHaveBeenCalled()
    let items: InboxItem[] = []
    for (let i = 0; i < MAX_INBOX + 5; i++) {
      items = addInbox(items, item(`i${i}`, 1000 + i))
      saver.save(items)
    }
    saver.flush()
    expect(write.mock.calls[0][0]).toHaveLength(MAX_INBOX)
  })
})
