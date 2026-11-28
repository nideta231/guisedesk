// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import Inbox from '../src/renderer/src/Inbox.vue'
import Sidebar from '../src/renderer/src/Sidebar.vue'

const accounts = [
  { id: 'a1', serviceId: 'whatsapp', label: 'Personal', colour: '#111', order: 0 },
  { id: 'a2', serviceId: 'discord', label: 'Work', colour: '#222', order: 1, muted: true }
]
const now = Date.now()
const items = [
  { id: 'i1', accountId: 'a1', title: 'Alice', body: 'Lunch at 12?', time: now, read: false },
  { id: 'i2', accountId: 'a2', title: 'Ben', body: 'Standup', time: now - 60_000, read: false },
  { id: 'i3', accountId: 'a1', title: 'Old', body: 'Hello', time: now - 24 * 3600_000, read: true }
]

describe('Inbox dialog (D64)', () => {
  it('shows newest first, grouped by day, with the account and service', () => {
    const w = mount(Inbox, { props: { items, accounts } })
    expect(w.findAll('.day').map((d) => d.text())).toEqual(['Today', 'Yesterday'])
    const rows = w.findAll('.item')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Personal')
    expect(rows[0].text()).toContain('WhatsApp')
    expect(rows[0].text()).toContain('Lunch at 12?')
    expect(rows[0].classes()).toContain('unread')
    expect(rows[2].classes()).not.toContain('unread')
  })

  it('filters by account and shows a plain empty state', async () => {
    const w = mount(Inbox, { props: { items, accounts } })
    await w.find('select.filter').setValue('a2')
    const rows = w.findAll('.item')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Work')
    await w.find('select.filter').setValue('a1')
    expect(w.findAll('.item')).toHaveLength(2)
    const empty = mount(Inbox, { props: { items: [], accounts } })
    expect(empty.find('.none').text()).toBe('No notifications yet.')
  })

  it('searches the text, keeps the day groups and shows a plain no-match state', async () => {
    const w = mount(Inbox, { props: { items, accounts } })
    await w.find('input.search').setValue('lunch')
    expect(w.findAll('.item')).toHaveLength(1)
    expect(w.find('.item').text()).toContain('Lunch at 12?')
    expect(w.find('.day').text()).toBe('Today')
    await w.find('input.search').setValue('ALICE lunch')
    expect(w.findAll('.item')).toHaveLength(1)
    await w.find('input.search').setValue('work')
    expect(w.findAll('.item')).toHaveLength(1)
    expect(w.find('.item').text()).toContain('Ben')
    await w.find('input.search').setValue('zzz')
    expect(w.find('.none').text()).toBe('No notifications match.')
  })

  it('clicking an item asks to select that account; the buttons emit read-all and clear', async () => {
    const w = mount(Inbox, { props: { items, accounts } })
    await w.findAll('.item')[1].trigger('click')
    expect(w.emitted('select')![0]).toEqual(['a2', 'i2'])
    const buttons = w.findAll('.bar .btn')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(w.emitted('read-all')).toHaveLength(1)
    expect(w.emitted('clear')).toHaveLength(1)
  })

  it('closes on X, Esc and a click outside', async () => {
    const w = mount(Inbox, { props: { items, accounts }, attachTo: document.body })
    await w.find('.x').trigger('click')
    await w.find('.veil').trigger('keydown', { key: 'Escape' })
    await w.find('.veil').trigger('click')
    expect(w.emitted('close')).toHaveLength(3)
    w.unmount()
  })
})

const bridge = { rowMenu: vi.fn(), onRowMenuPick: vi.fn() }
;(window as unknown as { guisedesk: unknown }).guisedesk = bridge

describe('Sidebar inbox bell (D64)', () => {
  const acc = (id: string, serviceId: string, label: string, order: number) => ({ id, serviceId, label, colour: '#6d5bd0', order })
  const rows = [acc('a1', 'whatsapp', 'Personal', 0)]

  it('sits in the footer, shows the unread count and opens the inbox', async () => {
    const w = mount(Sidebar, { props: { accounts: rows, inboxUnread: 4 } })
    expect(w.find('.foot .bell').exists()).toBe(true)
    expect(w.find('.foot .bell .badge').text()).toBe('4')
    expect(w.find('.foot .bell').attributes('title')).toBe('4 unread notifications')
    await w.find('.foot .bell').trigger('click')
    expect(w.emitted('inbox')).toHaveLength(1)
    const none = mount(Sidebar, { props: { accounts: rows } })
    expect(none.find('.foot .bell .badge').exists()).toBe(false)
    expect(none.find('.foot .bell').attributes('title')).toBe('Notifications')
  })
})

describe('App inbox wiring (D64)', () => {
  it('the bell opens the dialog, an item marks read and selects, and the dialog actions call main', async () => {
    const select = vi.fn()
    const inboxRead = vi.fn(async () => ({ items: items.map((i) => ({ ...i, read: true })), unread: 0 }))
    const inboxReadAll = vi.fn(async () => ({ items: items.map((i) => ({ ...i, read: true })), unread: 0 }))
    const inboxClear = vi.fn(async () => ({ items: [], unread: 0 }))
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts, selectedId: 'a1', disabledServices: [] }),
      unread: async () => ({}),
      onUnread: () => {},
      inbox: async () => ({ items, unread: 2 }),
      inboxRead,
      inboxReadAll,
      inboxClear,
      onInbox: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({}),
      onSleep: () => {},
      select,
      dialog: () => {},
      onSidebar: () => {},
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' })
    }
    const w = mount(App)
    await flushPromises()
    await w.find('.foot .bell').trigger('click')
    await flushPromises()
    expect(w.find('.inbox').exists()).toBe(true)
    const actions = w.findAll('.bar .btn')
    await actions[0].trigger('click')
    await flushPromises()
    expect(inboxReadAll).toHaveBeenCalled()
    await w.findAll('.item')[1].trigger('click')
    await flushPromises()
    expect(inboxRead).toHaveBeenCalledWith('i2')
    expect(select).toHaveBeenCalledWith('a2')
    expect(w.find('.inbox').exists()).toBe(false)
    await w.find('.foot .bell').trigger('click')
    await flushPromises()
    await w.findAll('.bar .btn')[1].trigger('click')
    await flushPromises()
    expect(inboxClear).toHaveBeenCalled()
  })
})

describe('hidden sidebar keeps the inbox reachable (UX-004)', () => {
  async function app(unread: number) {
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts, selectedId: 'a1', disabledServices: [], sidebarHidden: true }),
      unread: async () => ({}),
      onUnread: () => {},
      inbox: async () => ({ items: [], unread }),
      onInbox: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({}),
      onSleep: () => {},
      select: vi.fn(),
      dialog: () => {},
      onSidebar: () => {},
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' })
    }
    const w = mount(App)
    await flushPromises()
    return w
  }

  it('stacks a bell with the unread badge in the hidden strip, and it opens the inbox', async () => {
    const w = await app(2)
    expect(w.find('.side').exists()).toBe(false)
    expect(w.find('.sidestrip .bell').exists()).toBe(true)
    expect(w.find('.sidestrip .bell .badge').text()).toBe('2')
    expect(w.find('.sidestrip .bell').attributes('title')).toBe('2 unread notifications')
    await w.find('.sidestrip .bell').trigger('click')
    await flushPromises()
    expect(w.find('.inbox').exists()).toBe(true)
  })

  it('shows no badge when nothing is unread', async () => {
    const w = await app(0)
    expect(w.find('.sidestrip .bell').exists()).toBe(true)
    expect(w.find('.sidestrip .bell .badge').exists()).toBe(false)
  })
})
