// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import {
  ERR_ABORTED,
  isErrorPageUrl,
  isRealPageUrl,
  isReportableLoadError,
  shouldClearErrorOnFinish,
  shouldClearErrorOnStart,
  shouldReattachOnLoad
} from '../src/main/pageerror'

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

describe('error page URLs (UX-010r)', () => {
  it('recognises Chromium own error page and a real http(s) document', () => {
    expect(isErrorPageUrl('chrome-error://chromewebdata/')).toBe(true)
    expect(isErrorPageUrl('https://web.whatsapp.com/')).toBe(false)
    expect(isErrorPageUrl(undefined)).toBe(false)
    expect(isRealPageUrl('https://web.whatsapp.com/')).toBe(true)
    expect(isRealPageUrl('http://127.0.0.1:8080/')).toBe(true)
    expect(isRealPageUrl('chrome-error://chromewebdata/')).toBe(false)
  })

  it('keeps the card when the failed load is followed by the error page', () => {
    const errorPage = { isMainFrame: true, isSameDocument: false, url: 'chrome-error://chromewebdata/' }
    expect(shouldClearErrorOnStart(errorPage)).toBe(false)
    expect(shouldClearErrorOnFinish(errorPage.url)).toBe(false)
  })

  it('clears the card on a real reload and on a non-error finish', () => {
    const reload = { isMainFrame: true, isSameDocument: false, url: 'https://web.whatsapp.com/' }
    expect(shouldClearErrorOnStart(reload)).toBe(true)
    expect(shouldClearErrorOnFinish(reload.url)).toBe(true)
    expect(shouldClearErrorOnStart({ ...reload, isSameDocument: true })).toBe(false)
    expect(shouldClearErrorOnStart({ ...reload, isMainFrame: false })).toBe(false)
  })

  it('does not attach a page that starts loading while locked or with a dialog open', () => {
    const base = {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://web.whatsapp.com/',
      isSelected: true,
      unlocked: true,
      dialogOpen: false
    }
    expect(shouldReattachOnLoad(base)).toBe(true)
    expect(shouldReattachOnLoad({ ...base, unlocked: false })).toBe(false)
    expect(shouldReattachOnLoad({ ...base, dialogOpen: true })).toBe(false)
    expect(shouldReattachOnLoad({ ...base, isSelected: false })).toBe(false)
    expect(shouldReattachOnLoad({ ...base, url: 'chrome-error://chromewebdata/' })).toBe(false)
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
