// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import { ERR_ABORTED, isReportableLoadError } from '../src/main/pageerror'

describe('isReportableLoadError (UX-010)', () => {
  it('accepts a real main-frame failure', () => {
    expect(isReportableLoadError(true, -105)).toBe(true)
    expect(isReportableLoadError(true, -6)).toBe(true)
  })

  it('rejects a subframe and an aborted navigation', () => {
    expect(isReportableLoadError(false, -105)).toBe(false)
    expect(isReportableLoadError(true, ERR_ABORTED)).toBe(false)
    expect(isReportableLoadError(false, ERR_ABORTED)).toBe(false)
  })
})

describe('App retry card (UX-010)', () => {
  const wa = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#2f9e6e', order: 0 }

  async function app() {
    let push: (p: { id: string; code?: number; description?: string; cleared?: boolean }) => void = () => {}
    const reload = vi.fn()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: () => {},
      state: async () => ({ accounts: [wa], selectedId: 'wa1', disabledServices: [] }),
      unread: async () => ({}),
      onUnread: () => {},
      onSelected: () => {},
      onOpenSettings: () => {},
      sleep: async () => ({}),
      onSleep: () => {},
      onSidebar: () => {},
      onZoom: () => {},
      onLinkChoose: () => {},
      onRowMenuPick: () => {},
      onPageError: (cb: typeof push) => (push = cb),
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      select: vi.fn(),
      dialog: vi.fn(),
      reload,
      openSite: vi.fn()
    }
    const w = mount(App)
    await flushPromises()
    return { w, push, reload }
  }

  it('shows the description with Try again, which reloads the selected account', async () => {
    const { w, push, reload } = await app()
    expect(w.find('.page-error').exists()).toBe(false)
    push({ id: 'wa1', code: -105, description: 'NAME_NOT_RESOLVED' })
    await flushPromises()
    expect(w.find('.page-error').exists()).toBe(true)
    expect(w.find('.page-error .hint').text()).toBe('NAME_NOT_RESOLVED')
    await w.findAll('.page-error .btn').find((b) => b.text() === 'Try again')!.trigger('click')
    expect(reload).toHaveBeenCalledWith('wa1')
  })

  it('a later load event removes the card', async () => {
    const { w, push } = await app()
    push({ id: 'wa1', code: -105, description: 'NAME_NOT_RESOLVED' })
    await flushPromises()
    expect(w.find('.page-error').exists()).toBe(true)
    push({ id: 'wa1', cleared: true })
    await flushPromises()
    expect(w.find('.page-error').exists()).toBe(false)
  })
})
