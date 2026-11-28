// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { version } from '../package.json'
import App from '../src/renderer/src/App.vue'
import Sidebar from '../src/renderer/src/Sidebar.vue'

const acc = (id: string, serviceId: string, label: string, order: number) => ({
  id, serviceId, label, colour: '#6d5bd0', order
})
const accounts = [
  acc('wa1', 'whatsapp', 'Personal', 0),
  acc('ig1', 'instagram', '@ben.n', 1),
  acc('dc1', 'discord', 'ben_n', 2),
  acc('x1', 'x', '@ben_n', 3),
  acc('fb1', 'facebook', 'Ben N.', 4),
  acc('th1', 'threads', '@ben.n', 5),
  acc('tt1', 'tiktok', '@ben.n', 6)
]

const bridge = { rowMenu: vi.fn(), onRowMenuPick: vi.fn() }
;(window as unknown as { guisedesk: unknown }).guisedesk = bridge

describe('Sidebar', () => {
  const w = mount(Sidebar, { props: { accounts, selectedId: 'dc1' } })

  it('groups WhatsApp and Discord under Chats, the five feeds under Feeds, in stored order', () => {
    const secs = w.findAll('.sec').map((s) => s.text())
    expect(secs).toEqual(['Chats', 'Feeds'])
    const groups = w.findAll('.group')
    expect(groups[0].findAll('.row .name').map((n) => n.text())).toEqual(['PersonalWhatsApp', 'ben_nDiscord'])
    expect(groups[1].findAll('.row .name').map((n) => n.text())).toEqual([
      '@ben.nInstagram', '@ben_nX', 'Ben N.Facebook', '@ben.nThreads', '@ben.nTikTok'
    ])
  })

  it('shows initials avatar with colour and service badge, and marks the selected row', () => {
    const rows = w.findAll('.row')
    expect(rows[0].find('.av').text()).toContain('PE')
    expect(rows[0].find('.av').attributes('style')).toContain('background')
    expect(rows[0].find('.svc').exists()).toBe(true)
    expect(rows[0].find('.count').exists()).toBe(false)
    expect(rows[1].classes()).toContain('on')
    expect(rows[0].classes()).not.toContain('on')
  })

  it('shows the real service logo in each badge, a favicon for a custom site, and a + button', async () => {
    const rows = w.findAll('.row')
    expect(rows[0].find('.svc svg').html()).toContain('M12 2a10 10 0 0 0-8.6 15.1')
    expect(rows[1].find('.svc svg').html()).toContain('M19.3 5.3A16.5')
    const c = mount(Sidebar, {
      props: { accounts: [{ ...acc('c1', 'custom', 'Wiki', 0), custom: { name: 'Wiki', url: 'https://w.example.com', icon: 'data:image/png;base64,AAAA' } }] }
    })
    expect(c.find('.svc img').attributes('src')).toBe('data:image/png;base64,AAAA')
    await w.find('.brand .add').trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
  })

  it('emits select with the account id on click', async () => {
    await w.findAll('.row')[0].trigger('click')
    expect(w.emitted('select')![0]).toEqual(['wa1'])
  })

  it('shows a count pill only when the count is above 0, capped at 99+', () => {
    const c = mount(Sidebar, { props: { accounts, counts: { wa1: 3, ig1: 0, dc1: 150 } } })
    const rows = c.findAll('.row')
    expect(rows[0].find('.count').text()).toBe('3')
    expect(rows[1].find('.count').text()).toBe('99+')
    expect(rows[2].find('.count').exists()).toBe(false)
    expect(rows[2].find('.slot').exists()).toBe(true)
  })

  it('shows a muted account with a grey count and a muted sub line', () => {
    const c = mount(Sidebar, {
      props: { accounts: [{ ...acc('dc1', 'discord', 'ben_n', 0), muted: true }, acc('wa1', 'whatsapp', 'Personal', 1)], counts: { dc1: 1, wa1: 2 } }
    })
    const rows = c.findAll('.row')
    expect(rows[0].find('.count').classes()).toContain('muted')
    expect(rows[0].find('.name').text()).toBe('ben_nDiscord · muted')
    expect(rows[1].find('.count').classes()).not.toContain('muted')
    expect(rows[1].find('.name').text()).toBe('PersonalWhatsApp')
  })

  describe('row menu is native (D41)', () => {
    const pickers = () => bridge.onRowMenuPick.mock.calls.map((c) => c[0] as (p: { id: string; action: string }) => void)
    const setup = (props: { accounts: (ReturnType<typeof acc> & { muted?: boolean })[] }) => {
      bridge.rowMenu.mockClear()
      bridge.onRowMenuPick.mockClear()
      return mount(Sidebar, { props })
    }

    it('right-click asks main for the menu with the account id and draws no HTML menu', async () => {
      const c = setup({ accounts: [acc('dc1', 'discord', 'ben_n', 0), acc('wa1', 'whatsapp', 'Personal', 1)] })
      await c.findAll('.row')[1].trigger('contextmenu')
      expect(bridge.rowMenu).toHaveBeenCalledWith('wa1')
      expect(c.find('.ctx').exists()).toBe(false)
    })

    it('a mute pick emits mute with the opposite of the account state', () => {
      const c = setup({ accounts: [{ ...acc('dc1', 'discord', 'ben_n', 0), muted: true }, acc('wa1', 'whatsapp', 'Personal', 1)] })
      pickers().forEach((f) => { f({ id: 'wa1', action: 'mute' }); f({ id: 'dc1', action: 'mute' }) })
      expect(c.emitted('mute')).toEqual([['wa1', true], ['dc1', false]])
    })

    it('sleep and account picks emit sleep(id) and account(id)', () => {
      const c = setup({ accounts })
      pickers().forEach((f) => { f({ id: 'x1', action: 'sleep' }); f({ id: 'ig1', action: 'account' }) })
      expect(c.emitted('sleep')).toEqual([['x1']])
      expect(c.emitted('account')).toEqual([['ig1']])
    })
  })

  describe('drag to reorder (D28)', () => {
    const drag = async (c: ReturnType<typeof mount>, from: number, to: number) => {
      const rows = c.findAll('.row')
      await rows[from].trigger('dragstart')
      await rows[to].trigger('dragover')
      await rows[to].trigger('drop')
      await rows[from].trigger('dragend')
    }

    it('dropping a row on another row of the same group emits the full id list in the new order', async () => {
      const c = mount(Sidebar, { props: { accounts } })
      await drag(c, 0, 1)
      expect(c.emitted('reorder')![0]).toEqual([['ig1', 'dc1', 'wa1', 'x1', 'fb1', 'th1', 'tt1']])
    })

    it('shows a drop indicator on the target while dragging, and clears it after the drop', async () => {
      const c = mount(Sidebar, { props: { accounts } })
      const rows = c.findAll('.row')
      await rows[3].trigger('dragstart')
      await rows[5].trigger('dragover')
      expect(rows[5].classes().some((k) => k.startsWith('drop'))).toBe(true)
      await rows[0].trigger('dragover')
      expect(rows[0].classes().some((k) => k.startsWith('drop'))).toBe(false)
      await rows[5].trigger('drop')
      expect(rows[5].classes().some((k) => k.startsWith('drop'))).toBe(false)
    })

    it('works in the rail and ignores a drop on a row of the other group', async () => {
      const c = mount(Sidebar, { props: { accounts, collapsed: true } })
      await drag(c, 2, 0)
      expect(c.emitted('reorder')).toBeUndefined()
      await drag(c, 4, 6)
      expect(c.emitted('reorder')![0]).toEqual([['wa1', 'ig1', 'dc1', 'x1', 'th1', 'tt1', 'fb1']])
    })

    it('rows are draggable, a click still selects and right-click still opens the menu', async () => {
      const c = mount(Sidebar, { props: { accounts } })
      const row = c.findAll('.row')[0]
      expect(row.attributes('draggable')).toBe('true')
      await row.trigger('click')
      expect(c.emitted('select')![0]).toEqual(['wa1'])
      await row.trigger('contextmenu')
      expect(bridge.rowMenu).toHaveBeenCalledWith('wa1')
    })
  })

  describe('collapsed rail', () => {
    const counts = { wa1: 3, dc1: 150 }
    const c = mount(Sidebar, { props: { accounts, selectedId: 'dc1', counts, asleep: ['x1'], collapsed: true } })

    it('hides names and section labels, shows the name as a tooltip, keeps badges and counts', () => {
      expect(c.find('.side').classes()).toContain('mini')
      expect(c.find('.side').attributes('style')).toContain('width: 64px')
      expect(c.findAll('.name')).toHaveLength(0)
      expect(c.find('.bn').exists()).toBe(false)
      expect(c.findAll('.sec').map((s) => s.text())).toEqual(['', ''])
      const rows = c.findAll('.row')
      expect(rows[0].attributes('title')).toBe('Personal · WhatsApp')
      expect(rows[0].find('.svc svg').exists()).toBe(true)
      expect(rows[0].find('.count').text()).toBe('3')
      expect(rows[1].find('.count').text()).toBe('99+')
    })

    it('keeps the brand mark and + at the top, and the panel button toggles', async () => {
      expect(c.find('.brand svg[viewBox="0 0 32 32"]').exists()).toBe(true)
      expect(c.find('.brand .add').exists()).toBe(true)
      expect(c.find('.foot .tgl').attributes('title')).toBe('Expand sidebar (Ctrl+B)')
      await c.find('.foot .tgl').trigger('click')
      expect(c.emitted('toggle')).toHaveLength(1)
    })
  })

  describe('keyboard navigation (UX-001)', () => {
    it('exposes the rows as options in a listbox, each focusable, and marks the selected one', () => {
      expect(w.find('.listbox').attributes('role')).toBe('listbox')
      const rows = w.findAll('.row')
      expect(rows).toHaveLength(7)
      rows.forEach((r) => {
        expect(r.attributes('role')).toBe('option')
        expect(r.attributes('tabindex')).toBe('0')
      })
      expect(rows[1].attributes('aria-selected')).toBe('true')
      expect(rows[0].attributes('aria-selected')).toBe('false')
    })

    it('ArrowDown moves across Chats into Feeds, Enter selects the focused id, Home and End jump', async () => {
      const c = mount(Sidebar, { props: { accounts }, attachTo: document.body })
      const rows = c.findAll('.row')
      ;(rows[0].element as HTMLElement).focus()
      await rows[0].trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(rows[1].element)
      await rows[1].trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(rows[2].element)
      await rows[2].trigger('keydown', { key: 'Enter' })
      expect(c.emitted('select')).toEqual([['ig1']])
      await rows[2].trigger('keydown', { key: 'End' })
      expect(document.activeElement).toBe(rows[6].element)
      await rows[6].trigger('keydown', { key: 'Home' })
      expect(document.activeElement).toBe(rows[0].element)
      c.unmount()
    })

    it('wraps with the arrow keys and focuses the selected row after mount', async () => {
      const { flushPromises } = await import('@vue/test-utils')
      const c = mount(Sidebar, { props: { accounts, selectedId: 'dc1' }, attachTo: document.body })
      await flushPromises()
      const rows = c.findAll('.row')
      expect(document.activeElement).toBe(rows[1].element)
      await rows[1].trigger('keydown', { key: 'ArrowUp' })
      expect(document.activeElement).toBe(rows[0].element)
      await rows[0].trigger('keydown', { key: 'ArrowUp' })
      expect(document.activeElement).toBe(rows[6].element)
      await rows[6].trigger('keydown', { key: 'ArrowDown' })
      expect(document.activeElement).toBe(rows[0].element)
      c.unmount()
    })

    it('nextRow wraps at both ends and starts at the matching end from none', async () => {
      const { nextRow } = await import('../src/main/layout')
      expect(nextRow(6, 1, 7, true)).toBe(0)
      expect(nextRow(0, -1, 7, true)).toBe(6)
      expect(nextRow(2, 1, 7, false)).toBe(3)
      expect(nextRow(-1, 1, 7, true)).toBe(0)
      expect(nextRow(-1, -1, 7, true)).toBe(6)
      expect(nextRow(0, 1, 0, true)).toBe(-1)
    })
  })

  describe('switched-off services cue (UX-045)', () => {
    it('shows a muted footer button naming how many services are off and asks for Settings on Services', async () => {
      const c = mount(Sidebar, { props: { accounts, disabled: ['instagram', 'tiktok'] } })
      const off = c.find('.foot .offs')
      expect(off.exists()).toBe(true)
      expect(off.text()).toBe('2 services off')
      expect(off.attributes('title')).toBe('2 services off')
      await off.trigger('click')
      expect(c.emitted('settings')).toEqual([['Services']])
    })

    it('says one service for a single disabled service and shows nothing when all are on', () => {
      const one = mount(Sidebar, { props: { accounts, disabled: ['instagram'] } })
      expect(one.find('.foot .offs').text()).toBe('1 service off')
      const none = mount(Sidebar, { props: { accounts, disabled: [] } })
      expect(none.find('.foot .offs').exists()).toBe(false)
    })

    it('keeps an accessible label on the icon in the rail', () => {
      const c = mount(Sidebar, { props: { accounts, disabled: ['instagram', 'tiktok'], collapsed: true } })
      const off = c.find('.foot .offs')
      expect(off.exists()).toBe(true)
      expect(off.find('.offtxt').exists()).toBe(false)
      expect(off.attributes('aria-label')).toBe('2 services off')
    })
  })

  describe('Do Not Disturb chip (UX-049)', () => {
    it('shows a bell-off chip with the tooltip while Do Not Disturb is on and asks for Notifications', async () => {
      const c = mount(Sidebar, { props: { accounts, dnd: true } })
      const chip = c.find('.foot .dnd')
      expect(chip.exists()).toBe(true)
      expect(chip.attributes('title')).toBe('Do Not Disturb is on - click to change')
      expect(chip.attributes('aria-label')).toBe('Do Not Disturb is on - click to change')
      await chip.trigger('click')
      expect(c.emitted('notifications')).toHaveLength(1)
    })

    it('hides it when Do Not Disturb is off', () => {
      expect(mount(Sidebar, { props: { accounts, dnd: false } }).find('.foot .dnd').exists()).toBe(false)
      expect(mount(Sidebar, { props: { accounts } }).find('.foot .dnd').exists()).toBe(false)
    })

    it('keeps the chip in the rail', () => {
      const c = mount(Sidebar, { props: { accounts, dnd: true, collapsed: true } })
      expect(c.find('.foot .dnd').exists()).toBe(true)
      expect(c.find('.foot .dnd').attributes('aria-label')).toBe('Do Not Disturb is on - click to change')
    })
  })

  it('shows GuiseDesk v<package.json version> in the footer in full mode only', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(w.find('.foot .ver').text()).toBe(`GuiseDesk v${version}`)
    const c = mount(Sidebar, { props: { accounts, collapsed: true } })
    expect(c.find('.foot .ver').exists()).toBe(false)
  })

  it('full mode is 232px wide with the brand mark next to the name and a collapse button', () => {
    expect(w.find('.side').classes()).not.toContain('mini')
    expect(w.find('.side').attributes('style')).toContain('width: 232px')
    expect(w.find('.brand .bn').text()).toBe('GuiseDesk')
    expect(w.find('.brand svg[viewBox="0 0 32 32"]').exists()).toBe(true)
    expect(w.find('.foot .tgl').attributes('title')).toBe('Collapse sidebar (Ctrl+B)')
  })
})

describe('row menu listener cleanup', () => {
  it('removes the listener on unmount, so a hide/show cycle leaves one live listener and one mute', async () => {
    type Pick = (p: { id: string; action: string }) => void
    const live = new Set<Pick>()
    const dispose = vi.fn((cb: Pick) => live.delete(cb))
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      rowMenu: vi.fn(),
      onRowMenuPick: vi.fn((cb: Pick) => {
        live.add(cb)
        return () => dispose(cb)
      })
    }
    const first = mount(Sidebar, { props: { accounts } })
    first.unmount()
    const second = mount(Sidebar, { props: { accounts } })
    second.unmount()
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(live.size).toBe(0)
    const third = mount(Sidebar, { props: { accounts } })
    expect(live.size).toBe(1)
    for (const cb of live) cb({ id: 'wa1', action: 'mute' })
    expect(third.emitted('mute')).toEqual([['wa1', true]])
    third.unmount()
    expect(dispose).toHaveBeenCalledTimes(3)
  })
})

describe('App sidebar state', () => {
  it('starts collapsed from the saved state, the panel button asks main, and main changes (Ctrl+B) are followed', async () => {
    const { flushPromises } = await import('@vue/test-utils')
    const { vi } = await import('vitest')
    let push: (c: boolean) => void = () => {}
    const setSidebar = vi.fn()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts, selectedId: 'wa1', disabledServices: [], sidebarCollapsed: true }),
      unread: async () => ({}),
      onUnread: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({}),
      onSleep: () => {},
      select: () => {},
      dialog: () => {},
      setSidebar,
      onSidebar: (cb: typeof push) => (push = cb),
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' })
    }
    const a = mount(App)
    await flushPromises()
    expect(a.find('.side').classes()).toContain('mini')
    await a.find('.foot .tgl').trigger('click')
    expect(setSidebar).toHaveBeenCalledWith(false)
    push(false)
    await flushPromises()
    expect(a.find('.side').classes()).not.toContain('mini')
    push(true)
    await flushPromises()
    expect(a.find('.side').classes()).toContain('mini')
  })
})

describe('App DND wiring (UX-049)', () => {
  it('reads the state at startup, follows a push and opens Settings on Notifications from the chip', async () => {
    const { flushPromises } = await import('@vue/test-utils')
    let pushDnd: (on: boolean) => void = () => {}
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts, selectedId: 'wa1', disabledServices: [] }),
      unread: async () => ({}),
      onUnread: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({}),
      onSleep: () => {},
      select: () => {},
      dialog: () => {},
      setSidebar: () => {},
      onSidebar: () => {},
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      prefs: async () => ({ idleLock: 10, dnd: true, quietWorkHours: false, startOnLogin: false }),
      onDnd: (cb: (on: boolean) => void) => {
        pushDnd = cb
        return () => {}
      },
      onQuiet: () => () => {}
    }
    const w = mount(App)
    await flushPromises()
    expect(w.find('.foot .dnd').exists()).toBe(true)
    pushDnd(false)
    await flushPromises()
    expect(w.find('.foot .dnd').exists()).toBe(false)
    pushDnd(true)
    await flushPromises()
    await w.find('.foot .dnd').trigger('click')
    await flushPromises()
    expect(w.find('.settings').exists()).toBe(true)
    expect(w.find('.tabs .sel').text()).toBe('Notifications')
  })
})

describe('row menu Reload (UX-002)', () => {
  it('offers Reload for an awake account and for an asleep one', async () => {
    const { rowMenuItems } = await import('../src/main/contextmenu')
    expect(rowMenuItems({ muted: false, asleep: false }).map((i) => i.action)).toContain('reload')
    expect(rowMenuItems({ muted: false, asleep: true }).map((i) => i.action)).toContain('reload')
    expect(rowMenuItems({ muted: true, asleep: true }).find((i) => i.action === 'reload')?.label).toBe('Reload')
  })

  it('a reload pick calls the bridge once with the id and emits neither mute nor sleep', async () => {
    let pick: (p: { id: string; action: string }) => void = () => {}
    const reload = vi.fn()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      rowMenu: vi.fn(),
      onRowMenuPick: (cb: typeof pick) => {
        pick = cb
        return () => {}
      },
      reload
    }
    const w = mount(Sidebar, { props: { accounts } })
    pick({ id: 'wa1', action: 'reload' })
    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith('wa1')
    expect(w.emitted('mute')).toBeUndefined()
    expect(w.emitted('sleep')).toBeUndefined()
  })
})
