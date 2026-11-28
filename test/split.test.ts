// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadSplit, saveSplit } from '../src/main/accounts'
import App from '../src/renderer/src/App.vue'
import SplitDivider from '../src/renderer/src/SplitDivider.vue'
import TopBar from '../src/renderer/src/TopBar.vue'

const wa = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#2f9e6e', order: 1 }
const ig = { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#b04c7a', order: 2 }
const accounts = [wa, ig]
const tmp = () => mkdtempSync(join(tmpdir(), 'gd-split-'))

describe('split view setting (D62)', () => {
  it('round-trips the two accounts and the ratio in settings.json', () => {
    const dir = tmp()
    expect(loadSplit(dir)).toBeUndefined()
    saveSplit(dir, { a: 'wa1', b: 'ig1', ratio: 0.65 })
    expect(loadSplit(dir)).toEqual({ a: 'wa1', b: 'ig1', ratio: 0.65 })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).split).toEqual({ a: 'wa1', b: 'ig1', ratio: 0.65 })
  })

  it('clamps a bad ratio and ignores a broken entry', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ split: { a: 'wa1', b: 'ig1', ratio: 0.99 } }))
    expect(loadSplit(dir)?.ratio).toBe(0.8)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ split: { a: 'wa1' } }))
    expect(loadSplit(dir)).toBeUndefined()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ split: { a: 'wa1', b: 'wa1', ratio: 0.5 } }))
    expect(loadSplit(dir)).toBeUndefined()
  })

  it('clearing lets the next start open without a split', () => {
    const dir = tmp()
    saveSplit(dir, { a: 'wa1', b: 'ig1', ratio: 0.4 })
    saveSplit(dir, undefined)
    expect(loadSplit(dir)).toBeUndefined()
    expect('split' in JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toBe(false)
  })
})

describe('SplitDivider', () => {
  function mountDivider() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const w = mount(SplitDivider, { props: { ratio: 0.5 }, attachTo: host })
    const parent = w.find('.splitgrip').element.parentElement as HTMLElement
    parent.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 600, right: 900, bottom: 600, x: 100, y: 0, toJSON: () => ({}) })
    return { w, host, parent }
  }

  it('draws at the saved ratio and drags between 20 and 80 percent', async () => {
    const { w, host } = mountDivider()
    expect(w.find('.splitgrip').attributes('style')).toContain('left: 50%')
    const grip = w.find('.splitgrip')
    const pointer = async (type: string, clientX: number) => {
      grip.element.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }))
      await flushPromises()
    }
    await pointer('pointerdown', 500)
    await pointer('pointermove', 740)
    await pointer('pointerup', 340)
    expect(w.emitted('move')).toEqual([[0.5], [0.8]])
    expect(w.emitted('end')).toEqual([[0.3]])
    w.unmount()
    host.remove()
  })

  it('ignores moves when it was not pressed', async () => {
    const { w, host } = mountDivider()
    w.find('.splitgrip').element.dispatchEvent(new MouseEvent('pointermove', { clientX: 740, bubbles: true }))
    await flushPromises()
    expect(w.emitted('move')).toBeUndefined()
    w.unmount()
    host.remove()
  })
})

describe('TopBar split buttons (D62)', () => {
  it('shows Split and emits split-menu; in split it shows Close split instead', async () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false } })
    expect(w.find('.split').text()).toBe('Split')
    await w.find('.split').trigger('click')
    expect(w.emitted('split-menu')).toHaveLength(1)
    expect(w.emitted('close-split')).toBeUndefined()

    const on = mount(TopBar, { props: { account: wa, asleep: false, split: true } })
    expect(on.find('.split').text()).toBe('Close split')
    await on.find('.split').trigger('click')
    expect(on.emitted('close-split')).toHaveLength(1)
    expect(on.emitted('split-menu')).toBeUndefined()
  })

  it('hides both split buttons while the account sleeps', () => {
    expect(mount(TopBar, { props: { account: wa, asleep: true } }).find('.split').exists()).toBe(false)
  })
})

async function app(state: { accounts: typeof accounts; selectedId: string; disabledServices: string[]; split?: { b: string; ratio: number } } = { accounts, selectedId: 'wa1', disabledServices: [] }) {
  let pushSplit: (s: { b: string; ratio: number } | undefined) => void = () => {}
  const splitMenu = vi.fn()
  const closeSplit = vi.fn()
  const setSplitRatio = vi.fn()
  const saveSplitRatio = vi.fn()
  const dialog = vi.fn()
  ;(window as unknown as { guisedesk: unknown }).guisedesk = {
    lockState: async () => ({ state: 'unlocked' }),
    onLock: () => {},
    state: async () => state,
    unread: async () => ({}),
    onUnread: () => {},
    onSelected: () => {},
    onOpenSettings: () => {},
    sleep: async () => ({}),
    onSleep: () => {},
    onSidebar: () => {},
    onZoom: () => {},
    onLinkChoose: () => {},
    onSwitcher: () => {},
    onShortcuts: () => {},
    onSplit: (cb: typeof pushSplit) => (pushSplit = cb),
    onRowMenuPick: () => {},
    onUpdate: () => {},
    updateState: async () => ({ state: 'none' }),
    select: vi.fn(),
    dialog,
    splitMenu,
    closeSplit,
    setSplitRatio,
    saveSplitRatio
  }
  const w = mount(App)
  await flushPromises()
  return { w, pushSplit, splitMenu, closeSplit, setSplitRatio, saveSplitRatio }
}

describe('App split view (D62)', () => {
  it('opens the account menu, shows the divider when main says so, and closes it', async () => {
    const { w, pushSplit, splitMenu, closeSplit } = await app()
    expect(w.find('.top .split').text()).toBe('Split')
    expect(w.find('.splitgrip').exists()).toBe(false)
    await w.find('.top .split').trigger('click')
    expect(splitMenu).toHaveBeenCalledWith('wa1')

    pushSplit({ b: 'ig1', ratio: 0.5 })
    await flushPromises()
    expect(w.find('.top .split').text()).toBe('Close split')
    expect(w.find('.splitgrip').exists()).toBe(true)

    await w.find('.top .split').trigger('click')
    expect(closeSplit).toHaveBeenCalled()
  })

  it('restores a saved split from the state', async () => {
    const { w } = await app({ accounts, selectedId: 'wa1', disabledServices: [], split: { b: 'ig1', ratio: 0.3 } })
    expect(w.find('.top .split').text()).toBe('Close split')
    expect(w.find('.splitgrip').exists()).toBe(true)
    expect(w.find('.splitgrip').attributes('style')).toContain('left: 30%')
  })

  it('dragging the divider sends the new ratio and saves it on release', async () => {
    const { w, pushSplit, setSplitRatio, saveSplitRatio } = await app()
    pushSplit({ b: 'ig1', ratio: 0.5 })
    await flushPromises()
    const panel = w.find('.panel').element as HTMLElement
    panel.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 600, right: 900, bottom: 600, x: 100, y: 0, toJSON: () => ({}) })
    const grip = w.find('.splitgrip')
    await grip.trigger('pointerdown', { clientX: 500, pointerId: 1 })
    await grip.trigger('pointermove', { clientX: 740, pointerId: 1 })
    await grip.trigger('pointerup', { clientX: 740, pointerId: 1 })
    expect(setSplitRatio).toHaveBeenCalledWith(0.5)
    expect(setSplitRatio).toHaveBeenCalledWith(0.8)
    expect(saveSplitRatio).toHaveBeenCalledWith(0.8)
  })
})
