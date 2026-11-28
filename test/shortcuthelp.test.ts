// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { isHelpShortcut, SHORTCUTS } from '../src/main/shortcuts'
import App from '../src/renderer/src/App.vue'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'
import ShortcutHelp from '../src/renderer/src/ShortcutHelp.vue'

const accounts = [
  { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#111', order: 0 },
  { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#222', order: 1 }
]

const keys = () => SHORTCUTS.map((s) => s.keys)

describe('shortcut list (D60)', () => {
  it('covers every shortcut the app really has, in named groups', () => {
    for (const k of ['Ctrl+L', 'Ctrl+B', 'Ctrl+K', 'Ctrl+= / Ctrl+-', 'Ctrl+0', 'Ctrl+1 … Ctrl+9', 'Ctrl+Tab / Ctrl+Shift+Tab', 'Esc', 'Middle-click or Ctrl+click', 'Ctrl+W or Esc', 'F1', '?']) {
      expect(keys()).toContain(k)
    }
    expect(SHORTCUTS.every((s) => s.group && s.keys && s.title)).toBe(true)
    expect(new Set(SHORTCUTS.map((s) => s.group))).toEqual(new Set(['Accounts', 'Window', 'Privacy', 'Links and popups']))
  })

  it('F1 opens it; other keys and key-up do not', () => {
    expect(isHelpShortcut({ type: 'keyDown', key: 'F1' })).toBe(true)
    expect(isHelpShortcut({ type: 'keyUp', key: 'F1' })).toBe(false)
    expect(isHelpShortcut({ type: 'keyDown', key: 'F2' })).toBe(false)
  })
})

describe('ShortcutHelp', () => {
  it('lists every row from the shared array, grouped', () => {
    const w = mount(ShortcutHelp)
    expect(w.findAll('.hrow')).toHaveLength(SHORTCUTS.length)
    expect(w.findAll('.gt').map((g) => g.text())).toEqual(['Accounts', 'Window', 'Privacy', 'Links and popups'])
    expect(w.findAll('kbd').map((k) => k.text())).toEqual(keys())
  })

  it('X, a click outside and Esc close it', async () => {
    const w = mount(ShortcutHelp)
    await w.find('.ib.x').trigger('click')
    await w.find('.veil').trigger('click')
    await w.find('.glass').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(3)
  })
})

describe('Settings > General row', () => {
  it('the Keyboard shortcuts row emits shortcuts', async () => {
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      prefs: async () => ({ idleLock: 10, dnd: false, startOnLogin: false }),
      downloads: async () => ({ dir: '/dl', ask: false })
    }
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const row = w.findAll('.sr').find((r) => r.find('b').text() === 'Keyboard shortcuts')!
    expect(row).toBeTruthy()
    await row.find('.lnk').trigger('click')
    expect(w.emitted('shortcuts')).toHaveLength(1)
  })
})

async function app() {
  let help: () => void = () => {}
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
    onSwitcher: () => {},
    onShortcuts: (cb: () => void) => (help = cb),
    onRowMenuPick: () => {},
    onUpdate: () => {},
    updateState: async () => ({ state: 'none' }),
    select: () => {},
    dialog,
    prefs: async () => ({ idleLock: 10, dnd: false, startOnLogin: false }),
    downloads: async () => ({ dir: '/dl', ask: false })
  }
  const w = mount(App)
  await flushPromises()
  return { w, help, dialog }
}

describe('App shortcut cheat sheet', () => {
  it('F1 from main opens it and detaches the view; Esc closes it', async () => {
    const { w, help, dialog } = await app()
    help()
    await flushPromises()
    expect(w.find('.help').exists()).toBe(true)
    expect(dialog).toHaveBeenLastCalledWith(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.help').exists()).toBe(false)
    expect(dialog).toHaveBeenLastCalledWith(false)
  })

  it('? opens it when nothing is focused, but not while a field is focused', async () => {
    const { w } = await app()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    await flushPromises()
    expect(w.find('.help').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    await flushPromises()
    expect(w.find('.help').exists()).toBe(false)
    field.remove()
  })

  it('the Settings > General row opens it', async () => {
    const { w } = await app()
    await w.find('.brand .gear').trigger('click')
    await flushPromises()
    await w.findAll('.tabs button').find((s) => s.text() === 'General')!.trigger('click')
    await flushPromises()
    const row = w.findAll('.sr').find((r) => r.find('b').text() === 'Keyboard shortcuts')!
    await row.find('.lnk').trigger('click')
    await flushPromises()
    expect(w.find('.help').exists()).toBe(true)
  })
})
