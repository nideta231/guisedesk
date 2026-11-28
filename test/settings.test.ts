// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSheet from '../src/renderer/src/AccountSheet.vue'
import App from '../src/renderer/src/App.vue'
import Settings from '../src/renderer/src/Settings.vue'
import SettingsExtensions from '../src/renderer/src/SettingsExtensions.vue'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'
import SettingsServices from '../src/renderer/src/SettingsServices.vue'
import { editAccount, loadAccounts, saveAccounts } from '../src/main/accounts'
import { openAppTarget } from '../src/main/appopen'
import { runQuit } from '../src/main/appquit'

const acc = (id: string, serviceId: string, label: string, order: number, extra = {}) => ({ id, serviceId, label, colour: '#6d5bd0', order, ...extra })
const accounts = [
  acc('wa1', 'whatsapp', 'Personal', 0),
  acc('wa2', 'whatsapp', 'Work', 1),
  acc('dc1', 'discord', 'ben_n', 2, { muted: true }),
  acc('ig1', 'instagram', '@shop', 3),
  acc('ig2', 'instagram', '@ben', 4, { idlePolicy: 'always' }),
  acc('tt1', 'tiktok', '@t', 5)
]

describe('SettingsServices', () => {
  const w = mount(SettingsServices, { props: { accounts, disabled: ['tiktok'] } })
  const row = (name: string) => w.findAll('.sr').find((r) => r.find('b').text() === name)!

  it('lists services under Chats and Feeds with account count and summary', () => {
    expect(w.findAll('.card h4').map((h) => h.text())).toEqual(['Chats', 'Feeds'])
    expect(row('WhatsApp').find('.t span').text()).toBe('2 accounts · always on')
    expect(row('Discord').find('.t span').text()).toBe('1 account · always on · muted')
    expect(row('Instagram').find('.t span').text()).toBe('2 accounts · custom sleep settings')
    expect(row('TikTok').find('.t span').text()).toBe('Off · hidden from the sidebar, still logged in')
    expect(row('Facebook').find('.t span').text()).toBe('No accounts')
    expect(row('TikTok').find('.tg').classes()).not.toContain('on')
    expect(row('WhatsApp').find('.tg').classes()).toContain('on')
  })

  it('the switch emits toggle with the service and the new state', async () => {
    await row('WhatsApp').find('.tg').trigger('click')
    await row('TikTok').find('.tg').trigger('click')
    expect(w.emitted('toggle')).toEqual([['whatsapp', false], ['tiktok', true]])
  })

  it('clicking an account row emits open with the account id', async () => {
    const r = w.findAll('.ar').find((x) => x.text().includes('@shop'))!
    await r.trigger('click')
    expect(w.emitted('open')![0]).toEqual(['ig1'])
  })
})

describe('AccountSheet', () => {
  const ig = acc('ig1', 'instagram', '@shop', 3)
  const sel = (w: ReturnType<typeof mount>) => w.find('.seg span.sel').text()

  it('shows the account, the four sleep choices with the effective one marked, and the mute switch', () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    expect(w.find('h3').text()).toBe('@shop')
    expect(w.find('.hint').text()).toBe('Instagram account')
    expect(w.findAll('.seg span').map((s) => s.text())).toEqual(['Always on', 'Sleep after 30 min', '10 min', '1 hour'])
    expect(sel(w)).toBe('Sleep after 30 min')
    expect(sel(mount(AccountSheet, { props: { account: acc('wa1', 'whatsapp', 'P', 0) } }))).toBe('Always on')
    expect(sel(mount(AccountSheet, { props: { account: { ...ig, idlePolicy: '60' } } }))).toBe('1 hour')
    expect(w.find('.tg').classes()).not.toContain('on')
  })

  it('a sleep choice and the mute switch emit their change', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    await w.findAll('.seg span')[2].trigger('click')
    await w.find('.tg').trigger('click')
    expect(w.emitted('policy')![0]).toEqual(['10'])
    expect(w.emitted('mute')![0]).toEqual([true])
  })

  it('Log out asks first; only the confirm emits logout, and Cancel keeps the account', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    const btn = (t: string) => w.findAll('.btn').find((b) => b.text() === t)!
    await btn('Log out').trigger('click')
    expect(w.emitted('logout')).toBeUndefined()
    expect(w.find('.logoutconfirm').text()).toContain('Log out @shop? You will have to sign in again.')
    await w.find('.logoutconfirm .btn').trigger('click')
    expect(w.find('.logoutconfirm').exists()).toBe(false)
    expect(w.emitted('logout')).toBeUndefined()
    await btn('Log out').trigger('click')
    await w.findAll('.logoutconfirm .btn')[1].trigger('click')
    expect(w.emitted('logout')).toHaveLength(1)
    await btn('Done').trigger('click')
    expect(w.emitted('done')).toHaveLength(1)
  })

  it('Remove asks first; only the confirm emits remove, Cancel backs out', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    const btn = (t: string) => w.findAll('.btn').find((b) => b.text() === t)!
    await btn('Remove').trigger('click')
    expect(w.emitted('remove')).toBeUndefined()
    expect(w.find('.confirm').text()).toContain('@shop')
    await w.find('.confirm .btn').trigger('click')
    expect(w.find('.confirm').exists()).toBe(false)
    await btn('Remove').trigger('click')
    await btn('Remove').trigger('click')
    expect(w.emitted('remove')).toHaveLength(1)
  })
})

describe('Account sheet zoom row (UX-018)', () => {
  it('shows 120% for zoom 1 and 100% with Reset disabled when there is no zoom', async () => {
    const zoomed = mount(AccountSheet, { props: { account: { ...acc('ig1', 'instagram', '@shop', 3), zoom: 1 } } })
    const zr = zoomed.findAll('.sr').find((r) => r.find('b').text() === 'Zoom')!
    expect(zr.find('.t span').text()).toBe('120%')
    expect(zr.find('.btn').attributes('disabled')).toBeUndefined()
    await zr.find('.btn').trigger('click')
    expect(zoomed.emitted('reset-zoom')).toHaveLength(1)

    const plain = mount(AccountSheet, { props: { account: acc('ig1', 'instagram', '@shop', 3) } })
    const pr = plain.findAll('.sr').find((r) => r.find('b').text() === 'Zoom')!
    expect(pr.find('.t span').text()).toBe('100%')
    expect(pr.find('.btn').attributes('disabled')).toBeDefined()
    await pr.find('.btn').trigger('click')
    expect(plain.emitted('reset-zoom')).toBeUndefined()
  })
})

describe('Settings in the app', () => {
  let bridge: Record<string, ReturnType<typeof vi.fn> | unknown>
  let openSettings: () => void
  let onLock: (i: unknown) => void
  let rowPick: (p: { id: string; action: string }) => void
  const snap = (disabledServices: string[]) => ({ accounts, selectedId: 'wa1', disabledServices })

  beforeEach(() => {
    bridge = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: vi.fn((cb) => (onLock = cb)),
      state: vi.fn(async () => snap([])),
      unread: async () => ({}),
      onUnread: vi.fn(),
      onSelected: vi.fn(),
      sleep: async () => ({}),
      onSleep: vi.fn(),
      onSidebar: vi.fn(),
      rowMenu: vi.fn(),
      onZoom: vi.fn(),
      onLinkChoose: () => {},
      onRowMenuPick: vi.fn((cb) => { rowPick = cb }),
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      onOpenSettings: vi.fn((cb) => (openSettings = cb)),
      select: vi.fn(),
      dialog: vi.fn(),
      mute: vi.fn(async () => snap([])),
      setServiceEnabled: vi.fn(async (_id: string, on: boolean) => snap(on ? [] : ['whatsapp'])),
      prefs: vi.fn(async () => ({ startOnLogin: false })),
      downloads: vi.fn(async () => ({ dir: '/tmp', ask: false })),
      blocking: vi.fn(async () => ({ ads: false, popups: true })),
      openDataFolder: vi.fn(async () => true),
      showEventLog: vi.fn(async () => true),
      setPolicy: vi.fn(async () => snap([])),
      edit: vi.fn(async (v: { id: string; label: string; colour: string }) => ({
        accounts: accounts.map((a) => (a.id === v.id ? { ...a, label: v.label, colour: v.colour } : a)),
        selectedId: 'wa1',
        disabledServices: []
      })),
      logout: vi.fn(async () => snap([])),
      resetZoom: vi.fn(async () => snap([])),
      remove: vi.fn(async () => ({ accounts: accounts.slice(1), selectedId: 'wa2', disabledServices: [] }))
    }
    ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
  })

  const open = async () => {
    const w = mount(App)
    await flushPromises()
    await w.find('.brand .gear').trigger('click')
    return w
  }

  it('the gear and the tray open Settings in the main area, detach the view, and Back restores it', async () => {
    const w = await open()
    expect(w.find('.tabs .sel').text()).toBe('Services')
    expect(w.findAll('.tabs button').map((s) => s.text())).toEqual(['Services', 'Lock', 'Notifications', 'Extensions', 'General'])
    expect(w.find('aside.side').exists()).toBe(true)
    expect(bridge.dialog).toHaveBeenLastCalledWith(true)
    await w.find('.top .ib').trigger('click')
    expect(w.find('.tabs').exists()).toBe(false)
    expect(bridge.dialog).toHaveBeenLastCalledWith(false)
    openSettings()
    await flushPromises()
    expect(w.find('.tabs').exists()).toBe(true)
  })

  it('turning a service off sends it to main and takes its accounts out of the sidebar', async () => {
    const w = await open()
    expect(w.findAll('aside .row')).toHaveLength(6)
    await w.findAll('.sr').find((r) => r.find('b').text() === 'WhatsApp')!.find('.tg').trigger('click')
    await flushPromises()
    expect(bridge.setServiceEnabled).toHaveBeenCalledWith('whatsapp', false)
    expect(w.findAll('aside .row')).toHaveLength(4)
    expect(w.find('aside').text()).not.toContain('Personal')
  })

  it('an account row opens the sheet; its changes go to main; Done closes it', async () => {
    const w = await open()
    await w.findAll('.ar').find((r) => r.text().includes('@shop'))!.trigger('click')
    expect(w.find('.glass h3').text()).toBe('@shop')
    await w.findAll('.glass .seg span')[3].trigger('click')
    expect(bridge.setPolicy).toHaveBeenCalledWith('ig1', '60')
    await w.find('.glass .tg').trigger('click')
    expect(bridge.mute).toHaveBeenCalledWith('ig1', true)
    await w.findAll('.glass .btn').find((b) => b.text() === 'Log out')!.trigger('click')
    expect(bridge.logout).not.toHaveBeenCalled()
    await w.find('.glass .logoutconfirm .btn.dng').trigger('click')
    await flushPromises()
    expect(bridge.logout).toHaveBeenCalledWith('ig1')
    await w.findAll('.glass .btn').find((b) => b.text() === 'Done')!.trigger('click')
    expect(w.find('.glass').exists()).toBe(false)
  })

  it('saving the sheet header renames and recolours the account once and the header follows', async () => {
    const w = await open()
    await w.findAll('.ar').find((r) => r.text().includes('@shop'))!.trigger('click')
    await w.find('.glass .editlabel').setValue('  Boutique  ')
    await w.findAll('.glass .editcolours i').find((c) => c.attributes('data-colour') === '#2b8a6e')!.trigger('click')
    await w.findAll('.glass .editbtns .btn')[1].trigger('click')
    await flushPromises()
    const edit = bridge.edit as ReturnType<typeof vi.fn>
    expect(edit).toHaveBeenCalledOnce()
    expect(edit.mock.calls[0][0]).toEqual({ id: 'ig1', label: 'Boutique', colour: '#2b8a6e' })
    expect(w.find('.glass h3').text()).toBe('Boutique')
  })

  it('Remove after confirm drops the account from the list and closes the sheet', async () => {
    const w = await open()
    await w.findAll('.ar').find((r) => r.text().includes('Personal'))!.trigger('click')
    const btn = (t: string) => w.findAll('.glass .btn').find((b) => b.text() === t)!
    await btn('Remove').trigger('click')
    await btn('Remove').trigger('click')
    await flushPromises()
    expect(bridge.remove).toHaveBeenCalledWith('wa1')
    expect(w.find('.glass').exists()).toBe(false)
    expect(w.find('aside').text()).not.toContain('Personal')
  })

  it('General has an About and data card whose buttons call their bridge methods', async () => {
    const w = await open()
    await w.findAll('.tabs button').find((t) => t.text() === 'General')!.trigger('click')
    await flushPromises()
    const card = w.findAll('.card').find((c) => c.find('h4').text() === 'About and data')!
    expect(card.exists()).toBe(true)
    const buttons = card.findAll('.btn')
    expect(buttons.map((b) => b.text())).toEqual(['Open data folder', 'Show event log'])
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    const openData = bridge.openDataFolder as ReturnType<typeof vi.fn>
    const showLog = bridge.showEventLog as ReturnType<typeof vi.fn>
    expect(openData).toHaveBeenCalledOnce()
    expect(showLog).toHaveBeenCalledOnce()
  })

  it('the sheet zoom row shows the percentage and Reset calls resetZoom with the id (UX-018)', async () => {
    const state = bridge.state as ReturnType<typeof vi.fn>
    state.mockResolvedValueOnce({ accounts: accounts.map((a) => (a.id === 'ig1' ? { ...a, zoom: 1 } : a)), selectedId: 'wa1', disabledServices: [] })
    const w = await open()
    await w.findAll('.ar').find((r) => r.text().includes('@shop'))!.trigger('click')
    const row = w.findAll('.glass .sr').find((r) => r.find('b').text() === 'Zoom')!
    expect(row.find('.t span').text()).toBe('120%')
    await row.find('.btn').trigger('click')
    await flushPromises()
    expect(bridge.resetZoom).toHaveBeenCalledWith('ig1')
  })

  it('a sidebar context item opens the sheet', async () => {
    const w = mount(App)
    await flushPromises()
    await w.findAll('aside .row')[3].trigger('contextmenu')
    expect((bridge as { rowMenu: unknown }).rowMenu).toHaveBeenCalledWith('ig1')
    rowPick({ id: 'ig1', action: 'account' })
    await flushPromises()
    expect(w.find('.glass h3').text()).toBe('@shop')
  })

  it('locking closes Settings and drops the sheet; the tray cannot open it while locked', async () => {
    const w = await open()
    await w.findAll('.ar')[0].trigger('click')
    onLock({ state: 'locked', kind: 'pin', pinLength: 6 })
    await flushPromises()
    expect(w.find('.tabs').exists()).toBe(false)
    expect(w.find('.glass').exists()).toBe(false)
    openSettings()
    await flushPromises()
    expect(w.find('.tabs').exists()).toBe(false)
  })
})

describe('account rename and colour (UX-016)', () => {
  const ig = acc('ig1', 'instagram', '@shop', 3)

  it('saves a trimmed label and the picked colour once, and the header follows it', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    await w.find('.editlabel').setValue('  Boutique  ')
    await w.find('.editcolours i[data-colour="#2b8a6e"]').trigger('click')
    await w.find('.editbtns .btn.pri').trigger('click')
    expect(w.emitted('edit')).toEqual([['Boutique', '#2b8a6e']])
  })

  it('an empty label shows an error and emits nothing', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    await w.find('.editlabel').setValue('   ')
    await w.find('.editbtns .btn.pri').trigger('click')
    expect(w.find('.err').text()).toBe('Label is required')
    expect(w.emitted('edit')).toBeUndefined()
  })

  it('Cancel and Esc put the saved name and colour back', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    const input = w.find('.editlabel')
    const colours = w.findAll('.editcolours i')
    await input.setValue('Typo')
    await w.findAll('.editbtns .btn')[0].trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('@shop')

    await input.setValue('Other')
    await colours.find((c) => c.attributes('data-colour') === '#c7772a')!.trigger('click')
    await w.find('.glass').trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('@shop')
    expect(w.findAll('.editcolours i').find((c) => c.classes().includes('sel'))!.attributes('data-colour')).toBe('#6d5bd0')
  })

  it('the main edit helper ignores an unknown id, an empty label and a bad colour', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-edit-'))
    saveAccounts(dir, [{ id: 'a1', serviceId: 'instagram', label: 'Old', colour: '#6d5bd0', order: 0 }])
    expect(editAccount(dir, 'nope', 'New', '#123456').changed).toBe(false)
    expect(editAccount(dir, 'a1', '   ', '#123456').changed).toBe(false)
    expect(editAccount(dir, 'a1', 'New', 'red').changed).toBe(false)
    expect(loadAccounts(dir)[0]).toMatchObject({ label: 'Old', colour: '#6d5bd0' })

    expect(editAccount(dir, 'a1', '  New  ', '#ABCDEF').changed).toBe(true)
    expect(loadAccounts(dir)[0]).toMatchObject({ label: 'New', colour: '#abcdef' })
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Settings reopens the last tab (UX-006)', () => {
  const bridge = (last?: string) => ({
    lastSettingsTab: vi.fn(async () => last),
    saveLastSettingsTab: vi.fn(async () => true),
    prefs: vi.fn(async () => ({ idleLock: 10 as const, dnd: false, startOnLogin: false })),
    downloads: vi.fn(async () => ({ dir: '/dl', ask: false })),
    downloadsList: vi.fn(async () => []),
    blocking: vi.fn(async () => ({ ads: false, popups: true })),
    lockState: vi.fn(async () => ({ state: 'unlocked', kind: 'pin' })),
    schedule: vi.fn(async () => null)
  })

  it('starts on the saved tab, saves a switch, and an explicit tab prop still wins', async () => {
    const b = bridge('General')
    ;(window as unknown as { guisedesk: unknown }).guisedesk = b
    const w = mount(Settings, { props: { accounts, disabled: [] } })
    await flushPromises()
    expect(w.find('.tabs .sel').text()).toBe('General')
    expect(w.findComponent({ name: 'SettingsGeneral' }).exists()).toBe(true)
    await w.findAll('.tabs button').find((t) => t.text() === 'Lock')!.trigger('click')
    expect(b.saveLastSettingsTab).toHaveBeenCalledWith('Lock')
    await w.findAll('.tabs button').find((t) => t.text() === 'General')!.trigger('click')
    expect(b.saveLastSettingsTab).toHaveBeenLastCalledWith('General')

    b.lastSettingsTab.mockClear()
    const e = mount(Settings, { props: { accounts, disabled: [], tab: 'Lock' } })
    await flushPromises()
    expect(e.find('.tabs .sel').text()).toBe('Lock')
    expect(b.lastSettingsTab).not.toHaveBeenCalled()
    delete (window as unknown as { guisedesk?: unknown }).guisedesk
  })
})

describe('SettingsExtensions remove confirm (UX-043)', () => {
  const ext = { id: 'ext1', name: 'WA Web Plus', version: '1.0' }
  const withExt = acc('wa1', 'whatsapp', 'Personal', 0, { extensions: ['ext1'] })

  it('the first Remove asks, Cancel backs out and only the confirm removes once', async () => {
    const removeExtension = vi.fn(async () => [])
    ;(window as unknown as { guisedesk: unknown }).guisedesk = { extensions: async () => [ext], removeExtension }
    const w = mount(SettingsExtensions, { props: { accounts: [withExt] } })
    await flushPromises()
    const card = w.find('[data-ext="ext1"]')
    expect(card.find('.confirm').exists()).toBe(false)

    await card.find('.btn').trigger('click')
    expect(card.find('.confirm').text()).toContain('Remove WA Web Plus? It will be turned off for every account.')
    expect(removeExtension).not.toHaveBeenCalled()

    await card.find('.confirm .btn').trigger('click')
    expect(card.find('.confirm').exists()).toBe(false)
    expect(removeExtension).not.toHaveBeenCalled()

    await card.find('.btn').trigger('click')
    await card.find('.confirm .btn.dng').trigger('click')
    await flushPromises()
    expect(removeExtension).toHaveBeenCalledExactlyOnceWith('ext1')
  })
})

describe('SettingsExtensions service names (UX-044)', () => {
  it('shows the service name for a preset account and the custom name, never the raw id', async () => {
    const ext = { id: 'ext1', name: 'Helper', version: '1.0' }
    const list = [
      acc('wa1', 'whatsapp', 'Personal', 0),
      acc('cu1', 'custom', 'Wiki', 1, { custom: { name: 'Team Wiki', url: 'https://wiki.example.com/' } })
    ]
    ;(window as unknown as { guisedesk: unknown }).guisedesk = { extensions: async () => [ext], removeExtension: vi.fn(async () => []) }
    const w = mount(SettingsExtensions, { props: { accounts: list } })
    await flushPromises()
    const card = w.find('[data-ext="ext1"]')
    expect(card.text()).toContain('WhatsApp')
    expect(card.text()).toContain('Team Wiki')
    expect(card.text()).not.toContain('whatsapp')
    expect(card.text()).not.toContain('custom')
  })
})

describe('Settings > Notifications work-hours link (UX-048)', () => {
  it('the quiet switch works and the link opens the Lock tab with the work-hours card', async () => {
    const setQuietWorkHours = vi.fn(async () => true)
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      prefs: vi.fn(async () => ({ idleLock: 10, dnd: false, quietWorkHours: false, startOnLogin: false })),
      onDnd: vi.fn(),
      setQuietWorkHours,
      lockState: vi.fn(async () => ({ state: 'unlocked', kind: 'pin', pinLength: 6 })),
      schedule: vi.fn(async () => ({ on: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', workMinutes: 10, offMinutes: 30, count: 'unlock' })),
      saveLastSettingsTab: vi.fn(async () => undefined)
    }
    const w = mount(Settings, { props: { accounts, disabled: [], tab: 'Notifications' } })
    await flushPromises()
    await w.find('[aria-label="Quiet outside work hours"]').trigger('click')
    await flushPromises()
    expect(setQuietWorkHours).toHaveBeenCalledWith(true)
    expect(w.find('[aria-label="Quiet outside work hours"]').classes()).toContain('on')

    await w.find('.workhours').trigger('click')
    await flushPromises()
    expect(w.find('.tabs .sel').text()).toBe('Lock')
    expect(w.findAll('.card h4').map((h) => h.text())).toContain('Work-hours schedule')
  })
})

describe('Settings tabs from the keyboard (UX-005)', () => {
  const stubs = { SettingsServices: true, SettingsLock: true, SettingsNotifications: true, SettingsExtensions: true, SettingsGeneral: true }
  const open = () => mount(Settings, { props: { accounts, disabled: [] }, global: { stubs } })
  const tabs = (w: ReturnType<typeof mount>) => w.findAll('[role="tab"]')
  const selected = (w: ReturnType<typeof mount>) => tabs(w).findIndex((t) => t.attributes('aria-selected') === 'true')

  it('exposes role=tab with aria-selected inside a tablist', () => {
    const w = open()
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    expect(tabs(w).map((t) => t.text())).toEqual(['Services', 'Lock', 'Notifications', 'Extensions', 'General'])
    expect(selected(w)).toBe(0)
    expect(tabs(w)[0].attributes('tabindex')).toBe('0')
    expect(tabs(w)[1].attributes('tabindex')).toBe('-1')
  })

  it('ArrowRight moves Services to Lock and mounts that panel, Home returns to Services', async () => {
    const w = open()
    await tabs(w)[0].trigger('keydown', { key: 'ArrowRight' })
    expect(selected(w)).toBe(1)
    expect(w.findComponent({ name: 'SettingsLock' }).exists()).toBe(true)
    expect(w.findComponent({ name: 'SettingsServices' }).exists()).toBe(false)
    await tabs(w)[1].trigger('keydown', { key: 'Home' })
    expect(selected(w)).toBe(0)
    expect(w.findComponent({ name: 'SettingsServices' }).exists()).toBe(true)
  })

  it('End goes to General, ArrowLeft wraps to the last tab, and clicking still selects', async () => {
    const w = open()
    await tabs(w)[0].trigger('keydown', { key: 'End' })
    expect(selected(w)).toBe(4)
    expect(w.findComponent({ name: 'SettingsGeneral' }).exists()).toBe(true)
    await tabs(w)[4].trigger('keydown', { key: 'ArrowRight' })
    expect(selected(w)).toBe(0)
    await tabs(w).find((t) => t.text() === 'Extensions')!.trigger('click')
    expect(selected(w)).toBe(3)
    expect(w.findComponent({ name: 'SettingsExtensions' }).exists()).toBe(true)
  })
})

describe('app:open handler (UX-007)', () => {
  const io = (exists = true) => ({
    dir: '/data',
    logPath: '/data/events.log',
    exists: () => exists,
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn()
  })

  it('refuses a non-app sender and an unknown target', async () => {
    const a = io()
    expect(await openAppTarget('data', false, a)).toBe(false)
    expect(a.openPath).not.toHaveBeenCalled()
    expect(await openAppTarget('nope', true, a)).toBe(false)
    expect(a.showItemInFolder).not.toHaveBeenCalled()
  })

  it('opens the data folder, and shows the log only when the file exists', async () => {
    const a = io()
    expect(await openAppTarget('data', true, a)).toBe(true)
    expect(a.openPath).toHaveBeenCalledWith('/data')

    const missing = io(false)
    expect(await openAppTarget('log', true, missing)).toBe(false)
    expect(missing.showItemInFolder).not.toHaveBeenCalled()

    const found = io(true)
    expect(await openAppTarget('log', true, found)).toBe(true)
    expect(found.showItemInFolder).toHaveBeenCalledWith('/data/events.log')
  })

  it('reports a failed folder open', async () => {
    const a = io()
    a.openPath = vi.fn(async () => 'Permission denied')
    expect(await openAppTarget('data', true, a)).toBe(false)
  })
})

describe('Settings > General Quit (UX-031)', () => {
  it('shows a Quit button with the tray hint and calls quit once', async () => {
    const quit = vi.fn(async () => true)
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      prefs: async () => ({ startOnLogin: false }),
      downloads: async () => ({ dir: '/dl', ask: false }),
      blocking: async () => ({ ads: false, popups: true }),
      quit
    }
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const card = w.findAll('.card').find((c) => c.find('h4').text() === 'Quit')!
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('Closing the window only hides it to the tray.')
    await card.find('.btn.dng').trigger('click')
    expect(quit).toHaveBeenCalledOnce()
  })

  it('the main quit helper refuses a non-app sender and quits once for the app window', () => {
    const quit = vi.fn()
    expect(runQuit(false, quit)).toBe(false)
    expect(quit).not.toHaveBeenCalled()
    expect(runQuit(true, quit)).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
  })
})
