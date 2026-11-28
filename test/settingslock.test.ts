// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'
import SettingsLock from '../src/renderer/src/SettingsLock.vue'
import SettingsNotifications from '../src/renderer/src/SettingsNotifications.vue'

type Fn = ReturnType<typeof vi.fn>
let bridge: Record<string, Fn>
const install = (extra: Record<string, Fn> = {}) => {
  bridge = {
    lockState: vi.fn(async () => ({ state: 'unlocked', kind: 'pin', pinLength: 6 })),
    prefs: vi.fn(async () => ({ idleLock: 10, dnd: false, startOnLogin: false })),
    downloads: vi.fn(async () => ({ dir: '/dl', ask: false })),
    setIdle: vi.fn(async () => true),
    changeLock: vi.fn(async () => ({ ok: true })),
    lock: vi.fn(),
    setDnd: vi.fn(async () => true),
    onDnd: vi.fn(),
    setQuietWorkHours: vi.fn(async () => true),
    setStartOnLogin: vi.fn(async () => true),
    ...extra
  }
  ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
}
const btn = (w: ReturnType<typeof mount>, t: string) => w.findAll('.btn').find((b) => b.text() === t)!
const row = (w: ReturnType<typeof mount>, t: string) => w.findAll('.sr').find((r) => r.find('b').text() === t)!

describe('SettingsLock', () => {
  beforeEach(() => install())

  it('shows the frame 4 rows with the saved idle choice and the kind marked', async () => {
    const w = mount(SettingsLock)
    await flushPromises()
    expect(w.findAll('.card h4').map((h) => h.text())).toEqual(['Unlock', 'Lock when'])
    expect(row(w, 'Unlock with').find('.seg span.sel').text()).toBe('PIN')
    expect(row(w, 'Idle in GuiseDesk').findAll('.seg span').map((s) => s.text())).toEqual(['5 min', '10 min', '30 min', 'Manual'])
    expect(row(w, 'Idle in GuiseDesk').find('.seg span.sel').text()).toBe('10 min')
    expect(row(w, 'GuiseDesk starts').text()).toContain('Always on')
    expect(row(w, 'Lock now').text()).toContain('CTRL + L')
  })

  it('an idle choice goes to main and is marked', async () => {
    const w = mount(SettingsLock)
    await flushPromises()
    await row(w, 'Idle in GuiseDesk').findAll('.seg span')[3].trigger('click')
    await flushPromises()
    expect(bridge.setIdle).toHaveBeenCalledWith('manual')
    expect(row(w, 'Idle in GuiseDesk').find('.seg span.sel').text()).toBe('Manual')
  })

  it('Change asks the current entry and the new one twice, then sends all of it to main', async () => {
    const w = mount(SettingsLock)
    await flushPromises()
    await btn(w, 'Change').trigger('click')
    const inputs = w.findAll('.chg input')
    expect(inputs).toHaveLength(3)
    await inputs[0].setValue('123456')
    await inputs[1].setValue('654321')
    await inputs[2].setValue('654321')
    await btn(w, 'Save').trigger('click')
    await flushPromises()
    expect(bridge.changeLock).toHaveBeenCalledWith('123456', 'pin', '654321', '654321')
    expect(w.find('.chg').exists()).toBe(false)
  })

  it('shows main error and stays open', async () => {
    install({ changeLock: vi.fn(async () => ({ error: 'Wrong current entry' })) })
    const w = mount(SettingsLock)
    await flushPromises()
    await btn(w, 'Change').trigger('click')
    await w.findAll('.chg input')[0].setValue('000000')
    await btn(w, 'Save').trigger('click')
    await flushPromises()
    expect(w.find('.chg .err').text()).toBe('Wrong current entry')
  })

  it('clicking Password switches kind: the form asks for a password and sends kind password', async () => {
    install({ lockState: vi.fn(async () => ({ state: 'unlocked', kind: 'pin' })) })
    const w = mount(SettingsLock)
    await flushPromises()
    await row(w, 'Unlock with').findAll('.seg span')[1].trigger('click')
    expect(w.find('.chg').exists()).toBe(true)
    const inputs = w.findAll('.chg input')
    await inputs[0].setValue('123456')
    await inputs[1].setValue('longenough')
    await inputs[2].setValue('longenough')
    await btn(w, 'Save').trigger('click')
    await flushPromises()
    expect(bridge.changeLock).toHaveBeenCalledWith('123456', 'password', 'longenough', 'longenough')
  })

  it('Cancel closes the form; Lock now locks; Reset asks the app to start the reset flow', async () => {
    const w = mount(SettingsLock)
    await flushPromises()
    await btn(w, 'Change').trigger('click')
    await btn(w, 'Cancel').trigger('click')
    expect(w.find('.chg').exists()).toBe(false)
    await row(w, 'Lock now').find('.btn').trigger('click')
    expect(bridge.lock).toHaveBeenCalled()
    await btn(w, 'Reset').trigger('click')
    expect(w.emitted('reset')).toHaveLength(1)
  })
})

describe('SettingsNotifications', () => {
  const acc = [
    { id: 'a', serviceId: 'whatsapp', label: 'Work', colour: '#6d5bd0', order: 0, muted: true },
    { id: 'b', serviceId: 'discord', label: 'Ben', colour: '#6d5bd0', order: 1 }
  ]
  it('the DND switch reflects and sets Do Not Disturb, and follows the tray', async () => {
    let tray: (on: boolean) => void = () => {}
    install({ prefs: vi.fn(async () => ({ idleLock: 10, dnd: true, startOnLogin: false })), onDnd: vi.fn((cb) => { tray = cb }) })
    const w = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    expect(w.find('.tg').classes()).toContain('on')
    await w.find('.tg').trigger('click')
    expect(bridge.setDnd).toHaveBeenCalledWith(false)
    await flushPromises()
    expect(w.find('.tg').classes()).not.toContain('on')
    tray(true)
    await flushPromises()
    expect(w.find('.tg').classes()).toContain('on')
  })

  it('removes the DND listener on unmount, so only the live tab follows a later tray push', async () => {
    type Cb = (on: boolean) => void
    const live = new Set<Cb>()
    const dispose = vi.fn((cb: Cb) => live.delete(cb))
    install({ onDnd: vi.fn((cb: Cb) => { live.add(cb); return () => dispose(cb) }) })
    const first = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    first.unmount()
    const second = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    second.unmount()
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(live.size).toBe(0)
    const third = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    expect(live.size).toBe(1)
    for (const cb of live) cb(true)
    await flushPromises()
    expect(third.find('[aria-label="Do Not Disturb"]').classes()).toContain('on')
    third.unmount()
    expect(dispose).toHaveBeenCalledTimes(3)
  })

  it('lists only muted accounts, each with Unmute that emits unmute', async () => {
    install()
    const w = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    const rows = w.findAll('.ar')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Work')
    await rows[0].find('.btn').trigger('click')
    expect(w.emitted('unmute')![0]).toEqual(['a'])
    expect(mount(SettingsNotifications, { props: { accounts: [acc[1]] } }).text()).toContain('No muted accounts')
  })
})

describe('SettingsGeneral', () => {
  it('Start on login is off by default and the switch sends the change to main', async () => {
    install()
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    expect(w.find('.tg').classes()).not.toContain('on')
    await w.find('.tg').trigger('click')
    await flushPromises()
    expect(bridge.setStartOnLogin).toHaveBeenCalledWith(true)
    expect(w.find('.tg').classes()).toContain('on')
  })

  it('shows it on when main says it is set', async () => {
    install({ prefs: vi.fn(async () => ({ idleLock: 10, dnd: false, startOnLogin: true })) })
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    expect(w.find('.tg').classes()).toContain('on')
  })
})

describe('Settings tabs in the app', () => {
  it('Lock tab shows the lock settings; Reset opens the reset screen over the app, Cancel returns', async () => {
    install({
      state: vi.fn(async () => ({ accounts: [], selectedId: undefined, disabledServices: [] })),
      onLock: vi.fn(),
      unread: vi.fn(async () => ({})),
      onUnread: vi.fn(),
      onSelected: vi.fn(),
      sleep: vi.fn(async () => ({})),
      onSleep: vi.fn(),
      onSidebar: vi.fn(),
      onZoom: vi.fn(),
      onLinkChoose: vi.fn(),
      onRowMenuPick: vi.fn(),
      onUpdate: vi.fn(),
      updateState: vi.fn(async () => ({ state: 'none' })),
      onOpenSettings: vi.fn(),
      dialog: vi.fn()
    })
    const w = mount(App)
    await flushPromises()
    await w.find('.brand .gear').trigger('click')
    await w.findAll('.tabs button')[1].trigger('click')
    expect(w.find('.settings h4').text()).toBe('Unlock')
    await btn(w, 'Reset').trigger('click')
    expect(w.find('.lockv.reset').exists()).toBe(true)
    await btn(w, 'Cancel').trigger('click')
    expect(w.find('.tabs').exists()).toBe(true)
  })
})

describe('SettingsNotifications quiet outside work hours (D58)', () => {
  const acc: AccountRow[] = []

  it('is off by default and the switch sends the change to main', async () => {
    install()
    const w = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    const quiet = w.find('[aria-label="Quiet outside work hours"]')
    expect(quiet.classes()).not.toContain('on')
    await quiet.trigger('click')
    await flushPromises()
    expect(bridge.setQuietWorkHours).toHaveBeenCalledWith(true)
    expect(quiet.classes()).toContain('on')
  })

  it('shows it on when main says it is set and turns it off again', async () => {
    install({ prefs: vi.fn(async () => ({ idleLock: 10, dnd: false, quietWorkHours: true, startOnLogin: false })) })
    const w = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    const quiet = w.find('[aria-label="Quiet outside work hours"]')
    expect(quiet.classes()).toContain('on')
    await quiet.trigger('click')
    await flushPromises()
    expect(bridge.setQuietWorkHours).toHaveBeenCalledWith(false)
    expect(quiet.classes()).not.toContain('on')
  })

  it('keeps the tray DND switch separate', async () => {
    install({ prefs: vi.fn(async () => ({ idleLock: 10, dnd: false, quietWorkHours: true, startOnLogin: false })) })
    const w = mount(SettingsNotifications, { props: { accounts: acc } })
    await flushPromises()
    expect(w.find('[aria-label="Do Not Disturb"]').classes()).not.toContain('on')
    expect(w.find('[aria-label="Quiet outside work hours"]').classes()).toContain('on')
  })
})
