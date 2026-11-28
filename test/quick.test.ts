// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { filterAccounts, moveSelection, tokenScore } from '../src/main/quick'
import App from '../src/renderer/src/App.vue'
import QuickSwitcher from '../src/renderer/src/QuickSwitcher.vue'

const rows = [
  { id: 'wa1', label: 'Personal', service: 'WhatsApp' },
  { id: 'wa2', label: 'Work', service: 'WhatsApp' },
  { id: 'dc1', label: 'ben_n', service: 'Discord' },
  { id: 'ig1', label: '@shop', service: 'Instagram' }
]

describe('quick switcher matching (D59)', () => {
  it('an empty query keeps every account in the given order', () => {
    expect(filterAccounts(rows, '').map((r) => r.id)).toEqual(['wa1', 'wa2', 'dc1', 'ig1'])
    expect(filterAccounts(rows, '   ').map((r) => r.id)).toEqual(['wa1', 'wa2', 'dc1', 'ig1'])
  })

  it('matches the label or the service name, case-insensitive', () => {
    expect(filterAccounts(rows, 'pers').map((r) => r.id)).toEqual(['wa1'])
    expect(filterAccounts(rows, 'WHATS').map((r) => r.id)).toEqual(['wa1', 'wa2'])
    expect(filterAccounts(rows, 'discord').map((r) => r.id)).toEqual(['dc1'])
  })

  it('needs every whitespace-separated token to match something', () => {
    expect(filterAccounts(rows, 'work whats').map((r) => r.id)).toEqual(['wa2'])
    expect(filterAccounts(rows, 'shop insta').map((r) => r.id)).toEqual(['ig1'])
    expect(filterAccounts(rows, 'shop whats')).toEqual([])
  })

  it('accepts a loose subsequence match', () => {
    expect(tokenScore('Personal', 'prsnl')).toBeGreaterThan(0)
    expect(filterAccounts(rows, 'prsnl').map((r) => r.id)).toEqual(['wa1'])
  })

  it('returns nothing for a miss and ranks stronger matches first', () => {
    expect(filterAccounts(rows, 'zzz')).toEqual([])
    const ranked = filterAccounts(
      [
        { id: 'a', label: 'My WhatsApp', service: 'WhatsApp' },
        { id: 'b', label: 'WhatsApp', service: 'WhatsApp' },
        { id: 'c', label: 'Other', service: 'WhatsApp' }
      ],
      'whatsapp'
    )
    expect(ranked.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('moveSelection steps and wraps in both directions', () => {
    expect(moveSelection(0, 1, 3)).toBe(1)
    expect(moveSelection(2, 1, 3)).toBe(0)
    expect(moveSelection(0, -1, 3)).toBe(2)
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
})

const accounts = [
  { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#111', order: 0 },
  { id: 'wa2', serviceId: 'whatsapp', label: 'Work', colour: '#222', order: 1 },
  { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#333', order: 2 }
]

describe('QuickSwitcher', () => {
  it('lists every account with its service and filters as you type', async () => {
    const w = mount(QuickSwitcher, { props: { accounts } })
    expect(w.findAll('.results .row')).toHaveLength(3)
    expect(w.findAll('.results .row')[0].text()).toContain('Personal')
    expect(w.findAll('.results .row')[0].text()).toContain('WhatsApp')
    await w.find('.search').setValue('shop')
    const rows = w.findAll('.results .row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Shop')
    await w.find('.search').setValue('zzz')
    expect(w.find('.none').text()).toContain('No accounts match')
  })

  it('arrows move the highlight, Enter opens it, and the ends wrap', async () => {
    const w = mount(QuickSwitcher, { props: { accounts } })
    const input = w.find('.search')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(w.findAll('.results .row')[1].classes()).toContain('on')
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(w.findAll('.results .row')[0].classes()).toContain('on')
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(w.findAll('.results .row')[2].classes()).toContain('on')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('choose')).toEqual([['ig1']])
  })

  it('Esc, the X and a click outside close it', async () => {
    const w = mount(QuickSwitcher, { props: { accounts } })
    await w.find('.search').trigger('keydown', { key: 'Escape' })
    await w.find('.ib.x').trigger('click')
    await w.find('.veil').trigger('click')
    expect(w.emitted('close')).toHaveLength(3)
  })

  it('scrolls the highlighted row into view on the arrow keys, wrapping at the top', async () => {
    const w = mount(QuickSwitcher, { props: { accounts } })
    const rows = w.findAll('.results .row')
    const spies = rows.map((r) => {
      const fn = vi.fn()
      ;(r.element as HTMLElement).scrollIntoView = fn
      return fn
    })
    const input = w.find('.search')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(spies[1]).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    await input.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(spies[0]).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    await input.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(spies[2]).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
  })

  it('clicking a row chooses that account', async () => {
    const w = mount(QuickSwitcher, { props: { accounts } })
    await w.findAll('.results .row')[1].trigger('click')
    expect(w.emitted('choose')).toEqual([['wa2']])
  })
})

async function app() {
  let push: () => void = () => {}
  const select = vi.fn()
  const dialog = vi.fn()
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
    onSidebar: () => {},
    onZoom: () => {},
    onLinkChoose: () => {},
    onSwitcher: (cb: () => void) => (push = cb),
    onRowMenuPick: () => {},
    onUpdate: () => {},
    updateState: async () => ({ state: 'none' }),
    select,
    dialog
  }
  const w = mount(App)
  await flushPromises()
  return { w, push, select, dialog }
}

describe('QuickSwitcher asleep accounts (UX-024)', () => {
  it('marks sleeping rows, filters on the asleep token, and still ranks normal queries', async () => {
    const w = mount(QuickSwitcher, { props: { accounts, asleep: ['wa1'] } })
    const all = w.findAll('.results .row')
    expect(all[0].find('.asleep').text()).toBe('Asleep')
    expect(all[1].find('.asleep').exists()).toBe(false)
    expect(all[2].find('.asleep').exists()).toBe(false)

    await w.find('.search').setValue('asleep')
    const sleeping = w.findAll('.results .row')
    expect(sleeping).toHaveLength(1)
    expect(sleeping[0].text()).toContain('Personal')
    await sleeping[0].trigger('click')
    expect(w.emitted('choose')).toEqual([['wa1']])

    await w.find('.search').setValue('work')
    const ranked = w.findAll('.results .row')
    expect(ranked).toHaveLength(1)
    expect(ranked[0].text()).toContain('Work')
  })

  it('an account literally named asleep is not hidden by the token', async () => {
    const named = [...accounts, { id: 'zz', serviceId: 'custom', label: 'asleep', colour: '#444', order: 3 }]
    const w = mount(QuickSwitcher, { props: { accounts: named, asleep: ['wa1'] } })
    await w.find('.search').setValue('asleep')
    const text = w.findAll('.results .row').map((r) => r.text())
    expect(text.some((t) => t.includes('Personal'))).toBe(true)
    expect(text.some((t) => t.includes('asleep'))).toBe(true)
  })
})

describe('App quick switcher', () => {
  it('Ctrl+K from main opens the dialog, detaches the view and picks on click', async () => {
    const { w, push, select, dialog } = await app()
    push()
    await flushPromises()
    expect(w.find('.switcher').exists()).toBe(true)
    expect(dialog).toHaveBeenLastCalledWith(true)
    await w.findAll('.switcher .row')[2].trigger('click')
    await flushPromises()
    expect(select).toHaveBeenCalledWith('ig1')
    expect(w.find('.switcher').exists()).toBe(false)
    expect(dialog).toHaveBeenLastCalledWith(false)
  })

  it('Esc closes it and restores the view', async () => {
    const { w, push, dialog } = await app()
    push()
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.switcher').exists()).toBe(false)
    expect(dialog).toHaveBeenLastCalledWith(false)
  })
})
