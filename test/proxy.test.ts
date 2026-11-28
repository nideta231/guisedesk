// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadAccounts, loadProxyAuth, saveDnd, saveProxyAuth, setAccountProxy } from '../src/main/accounts'
import { effectiveProxy, findProxyCredential, parseProxy, proxyLabel, proxyMenu, proxyRules, sameProxy } from '../src/main/proxy'
import AccountSheet from '../src/renderer/src/AccountSheet.vue'
import TopBar from '../src/renderer/src/TopBar.vue'

const wa = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#2f9e6e', order: 1 }
const ig = { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#b04c7a', order: 2 }
const tmp = () => mkdtempSync(join(tmpdir(), 'gd-proxy-'))

describe('proxy address parsing (D63)', () => {
  it('accepts http, https and socks5 with a host and port', () => {
    expect(parseProxy('socks5://127.0.0.1:1080')).toEqual({ ok: true, value: { scheme: 'socks5', host: '127.0.0.1', port: 1080 } })
    expect(parseProxy(' http://proxy.local:8080 ')).toEqual({ ok: true, value: { scheme: 'http', host: 'proxy.local', port: 8080 } })
    expect(parseProxy('https://[::1]:8443')).toEqual({ ok: true, value: { scheme: 'https', host: '[::1]', port: 8443 } })
  })

  it('takes a user and password out of the rules handed to the session', () => {
    const r = parseProxy('http://ann:p%40ss@proxy.local:3128')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({ username: 'ann', password: 'p@ss' })
    expect(proxyRules(r.value)).toBe('http://proxy.local:3128')
    expect(proxyLabel(r.value)).toBe('proxy.local:3128')
  })

  it('rejects a bad address with a short plain message', () => {
    for (const s of ['', '   ', 'proxy.local:1080', 'ftp://h:21', 'socks5://h', 'socks5://h:0', 'socks5://h:70000', 'socks5://h:1080/x', 'socks5://h:1080?x=1', 'socks5://h:1080#x', 'socks5://a b:1080', 'http://ann@proxy.local:3128'])
      expect(parseProxy(s).ok).toBe(false)
    expect(parseProxy(42).ok).toBe(false)
    const bad = parseProxy('ftp://h:21')
    expect(!bad.ok && bad.error).toMatch(/http:\/\/, https:\/\/ or socks5:\/\//)
    const noPort = parseProxy('socks5://h')
    expect(!noPort.ok && noPort.error).toMatch(/port/i)
  })

  it('compares endpoints without the credentials', () => {
    const a = parseProxy('http://u:p@proxy.local:8080')
    const b = parseProxy('http://proxy.local:8080')
    expect(a.ok && b.ok && sameProxy(a.value, b.value)).toBe(true)
    const c = parseProxy('http://proxy.local:8081')
    expect(c.ok && a.ok && sameProxy(a.value, c.value)).toBe(false)
  })

  it('builds the chip menu from the address, without credentials', () => {
    const p = parseProxy('http://u:p@proxy.local:8080')
    if (!p.ok) throw new Error('parse failed')
    expect(proxyMenu(p.value).map((i) => i.label)).toEqual(['proxy.local:8080', '', 'Test connection', 'Change...'])
    expect(proxyMenu(undefined).map((i) => i.label)).toEqual(['Direct connection', '', 'Test connection', 'Change...'])
    expect(proxyMenu(undefined)[2].enabled).toBe(false)
  })
})

describe('proxy follow and sign-in matching (D63)', () => {
  const accounts = [
    { id: 'ig1', proxy: 'http://proxy.local:8080' },
    { id: 'th1', shareWith: 'ig1' },
    { id: 'x1', proxy: 'socks5://other:1080' }
  ]

  it('a shared login follows its host; a missing host has none', () => {
    expect(effectiveProxy(accounts[1], accounts)).toBe('http://proxy.local:8080')
    expect(effectiveProxy(accounts[0], accounts)).toBe('http://proxy.local:8080')
    expect(effectiveProxy({ id: 'z' }, accounts)).toBeUndefined()
    expect(effectiveProxy({ id: 'z', shareWith: 'gone' }, accounts)).toBeUndefined()
  })

  it('matches a Chromium proxy challenge to the partition that saved the sign-in', () => {
    const auth = { ig1: { username: 'ann', password: 'secret' } }
    expect(findProxyCredential(accounts as never, auth, 'PROXY.local', 8080)).toEqual({ username: 'ann', password: 'secret' })
    expect(findProxyCredential(accounts as never, auth, 'other', 1080)).toBeUndefined()
    expect(findProxyCredential(accounts as never, {}, 'proxy.local', 8080)).toBeUndefined()
  })
})

describe('proxy storage (D63)', () => {
  it('saves the address on the account and the sign-in in settings.json', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify([wa, ig]))
    setAccountProxy(dir, 'wa1', 'socks5://127.0.0.1:1080')
    expect(loadAccounts(dir).find((a) => a.id === 'wa1')?.proxy).toBe('socks5://127.0.0.1:1080')
    saveProxyAuth(dir, 'wa1', { username: 'ann', password: 'secret' })
    expect(loadProxyAuth(dir)).toEqual({ wa1: { username: 'ann', password: 'secret' } })
    // The password is in settings.json only, never in accounts.json.
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).not.toContain('secret')
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).proxyAuth.wa1.password).toBe('secret')
  })

  it('clears the address and the sign-in, and ignores a broken entry', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify([wa]))
    setAccountProxy(dir, 'wa1', 'http://h:8080')
    saveProxyAuth(dir, 'wa1', { username: 'u', password: 'p' })
    setAccountProxy(dir, 'wa1', undefined)
    saveProxyAuth(dir, 'wa1', undefined)
    expect('proxy' in loadAccounts(dir)[0]).toBe(false)
    expect(loadProxyAuth(dir)).toEqual({})
    expect('proxyAuth' in JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toBe(false)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ proxyAuth: { wa1: { username: 5 } } }))
    expect(loadProxyAuth(dir)).toEqual({})
  })

  it('keeps settings.json private before and after later settings writes', () => {
    const dir = tmp()
    saveProxyAuth(dir, 'wa1', { username: 'ann', password: 'secret' })
    expect(statSync(join(dir, 'settings.json')).mode & 0o777).toBe(0o600)
    saveDnd(dir, true)
    expect(statSync(join(dir, 'settings.json')).mode & 0o777).toBe(0o600)
    expect(loadProxyAuth(dir)).toEqual({ wa1: { username: 'ann', password: 'secret' } })
  })
})

describe('AccountSheet network (D63)', () => {
  it('shows Direct by default, clears a saved proxy, and refuses a bad address', async () => {
    const plain = mount(AccountSheet, { props: { account: wa } })
    expect(plain.find('.proxyinp').exists()).toBe(false)
    expect(plain.find('.proxyseg span.sel').text()).toBe('Direct')

    const saved = mount(AccountSheet, { props: { account: { ...wa, proxy: 'socks5://127.0.0.1:1080' } } })
    expect(saved.find('.proxyinp').element).toHaveProperty('value', 'socks5://127.0.0.1:1080')
    await saved.findAll('.proxyseg span').find((s) => s.text() === 'Direct')!.trigger('click')
    expect(saved.emitted('proxy')).toEqual([['']])

    const w = mount(AccountSheet, { props: { account: wa } })
    await w.findAll('.proxyseg span').find((s) => s.text() === 'Proxy')!.trigger('click')
    await w.find('.proxyinp').setValue('not a proxy')
    await w.find('.proxysave').trigger('click')
    expect(w.find('.hint.warn').text()).toMatch(/proxy/i)
    expect(w.emitted('proxy')).toBeUndefined()
    await w.find('.proxyinp').setValue('socks5://127.0.0.1:1080')
    await w.find('.proxysave').trigger('click')
    expect(w.emitted('proxy')).toEqual([['socks5://127.0.0.1:1080']])
  })

  it('follows the host for a shared login and shows the saved sign-in name', () => {
    const host = { id: 'ig1', serviceId: 'instagram', label: 'Main', colour: '#000', order: 0 }
    const shared = { id: 'th1', serviceId: 'threads', label: 'Threads', colour: '#000', order: 1, shareWith: 'ig1' }
    const w = mount(AccountSheet, { props: { account: shared, accounts: [host, shared] } })
    expect(w.find('.proxyseg').exists()).toBe(false)
    expect(w.find('.proxyinp').exists()).toBe(false)
    expect(w.text()).toContain('Uses the proxy of Main')
    const signed = mount(AccountSheet, { props: { account: { ...wa, proxy: 'http://h:8080', proxyUser: 'ann' } } })
    expect(signed.text()).toContain('Signs in to the proxy as ann')
  })
})

describe('TopBar proxy chip (D63)', () => {
  it('shows only when a proxy is set and opens the native menu', async () => {
    expect(mount(TopBar, { props: { account: wa, asleep: false } }).find('.chip.proxy').exists()).toBe(false)
    const w = mount(TopBar, { props: { account: wa, asleep: false, proxy: 'socks5://127.0.0.1:1080' } })
    const chip = w.find('.chip.proxy')
    expect(chip.text()).toBe('Proxy')
    expect(chip.attributes('title')).toBe('Proxy: 127.0.0.1:1080')
    expect(chip.attributes('title')).not.toContain('1080:') // no password in the title
    await chip.trigger('click')
    expect(w.emitted('proxy-menu')).toHaveLength(1)
  })
})

async function app() {
  const App = (await import('../src/renderer/src/App.vue')).default
  let openSheet: (id: string) => void = () => {}
  const proxyMenu = vi.fn()
  const setProxy = vi.fn(async (id: string, value: string) => ({
    accounts: [{ ...wa, proxy: value || undefined }],
    selectedId: 'wa1',
    disabledServices: []
  }))
  ;(window as unknown as { guisedesk: unknown }).guisedesk = {
    lockState: async () => ({ state: 'unlocked' }),
    onLock: () => {},
    state: async () => ({ accounts: [{ ...wa, proxy: 'socks5://127.0.0.1:1080' }], selectedId: 'wa1', disabledServices: [] }),
    unread: async () => ({}),
    onUnread: () => {},
    onSelected: () => {},
    onOpenSettings: () => {},
    onOpenSheet: (cb: typeof openSheet) => (openSheet = cb),
    sleep: async () => ({}),
    onSleep: () => {},
    onSidebar: () => {},
    onZoom: () => {},
    onLinkChoose: () => {},
    onRowMenuPick: () => {},
    onUpdate: () => {},
    updateState: async () => ({ state: 'none' }),
    select: vi.fn(),
    dialog: vi.fn(),
    lock: vi.fn(),
    reload: vi.fn(),
    sleepNow: vi.fn(),
    mute: vi.fn(),
    proxyMenu,
    setProxy
  }
  const w = mount(App)
  await flushPromises()
  return { w, proxyMenu, setProxy, open: (id: string) => openSheet(id) }
}

describe('App proxy wiring (D63)', () => {
  it('the chip opens main\'s proxy menu and Change opens the account sheet', async () => {
    const { w, proxyMenu, open } = await app()
    expect(w.find('.top .chip.proxy').text()).toBe('Proxy')
    await w.find('.top .chip.proxy').trigger('click')
    expect(proxyMenu).toHaveBeenCalledWith('wa1')

    open('wa1')
    await flushPromises()
    expect(w.find('.proxyinp').exists()).toBe(true)
  })

  it('saving a new address from the sheet goes through setProxy', async () => {
    const { w, setProxy, open } = await app()
    open('wa1')
    await flushPromises()
    await w.find('.proxyinp').setValue('socks5://10.0.0.1:1080')
    await w.find('.proxysave').trigger('click')
    await flushPromises()
    expect(setProxy).toHaveBeenCalledWith('wa1', 'socks5://10.0.0.1:1080')
  })
})
