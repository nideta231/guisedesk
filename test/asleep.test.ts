// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import AsleepPanel from '../src/renderer/src/AsleepPanel.vue'
import Sidebar from '../src/renderer/src/Sidebar.vue'

const ig = { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#b04c7a', order: 1 }

describe('AsleepPanel', () => {
  it('shows avatar, "<Label> is asleep", the reason with minutes, and a Wake up button that emits wake', async () => {
    const w = mount(AsleepPanel, { props: { account: ig, minutes: 30 } })
    expect(w.find('.bigav').text()).toContain('SH')
    expect(w.find('.bigav .svc').exists()).toBe(true)
    expect(w.find('h2').text()).toBe('Shop is asleep')
    expect(w.find('p').text()).toContain('Unloaded after 30 minutes unused to save memory.')
    expect(w.find('p').text()).toContain('No notifications until it wakes.')
    await w.find('.btn.pri').trigger('click')
    expect(w.find('.btn.pri').text()).toBe('Wake up')
    expect(w.emitted('wake')).toHaveLength(1)
  })
})

describe('AsleepPanel manual sleep', () => {
  it('with minutes 0 says Unloaded to save memory with no minutes text', () => {
    const w = mount(AsleepPanel, { props: { account: ig, minutes: 0 } })
    expect(w.find('p').text()).toContain('Unloaded to save memory.')
    expect(w.find('p').text()).not.toContain('minutes')
  })
})

describe('Sidebar asleep rows', () => {
  beforeEach(() => {
    ;(window as unknown as { guisedesk: unknown }).guisedesk = { rowMenu: vi.fn(), onRowMenuPick: vi.fn() }
  })

  it('dims asleep rows and shows ZZ in place of the count', () => {
    const w = mount(Sidebar, { props: { accounts: [ig, { ...ig, id: 'x1', serviceId: 'x', order: 2 }], asleep: ['ig1'], counts: { ig1: 4 } } })
    const rows = w.findAll('.row')
    expect(rows[0].classes()).toContain('sleep')
    expect(rows[0].find('.zz').text()).toBe('ZZ')
    expect(rows[0].find('.count').exists()).toBe(false)
    expect(rows[1].classes()).not.toContain('sleep')
    expect(rows[1].find('.zz').exists()).toBe(false)
  })
})

describe('App asleep panel', () => {
  it('shows the panel in the content area while the selected account is asleep, Wake up selects it', async () => {
    const { flushPromises } = await import('@vue/test-utils')
    let push: (s: Record<string, { minutes: number; waking: boolean }>) => void = () => {}
    const select = (await import('vitest')).vi.fn()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts: [ig], selectedId: 'ig1', disabledServices: [] }),
      unread: async () => ({}),
      onUnread: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({ ig1: { minutes: 30, waking: false } }),
      onSleep: (cb: typeof push) => (push = cb),
      onSidebar: () => {},
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      select,
      dialog: () => {}
    }
    const w = mount(App)
    await flushPromises()
    expect(w.find('.asleep h2').text()).toBe('Shop is asleep')
    await w.find('.asleep .btn.pri').trigger('click')
    expect(select).toHaveBeenCalledWith('ig1')
    push({})
    await flushPromises()
    expect(w.find('.asleep').exists()).toBe(false)
  })
})
