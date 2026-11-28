// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSheet from '../src/renderer/src/AccountSheet.vue'
import App from '../src/renderer/src/App.vue'
import SettingsServices from '../src/renderer/src/SettingsServices.vue'
import { editAccount, loadAccounts, saveAccounts } from '../src/main/accounts'

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

  it('Log out emits logout; Done emits done', async () => {
    const w = mount(AccountSheet, { props: { account: ig } })
    await w.findAll('.btn').find((b) => b.text() === 'Log out')!.trigger('click')
    expect(w.emitted('logout')).toHaveLength(1)
    await w.findAll('.btn').find((b) => b.text() === 'Done')!.trigger('click')
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
      setPolicy: vi.fn(async () => snap([])),
      edit: vi.fn(async (v: { id: string; label: string; colour: string }) => ({
        accounts: accounts.map((a) => (a.id === v.id ? { ...a, label: v.label, colour: v.colour } : a)),
        selectedId: 'wa1',
        disabledServices: []
      })),
      logout: vi.fn(async () => snap([])),
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
    expect(w.findAll('.tabs span').map((s) => s.text())).toEqual(['Services', 'Lock', 'Notifications', 'Extensions', 'General'])
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
