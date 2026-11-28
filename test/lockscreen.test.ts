// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capsLockOn } from '../src/main/capslock'
import App from '../src/renderer/src/App.vue'
import LockScreen from '../src/renderer/src/LockScreen.vue'
import ResetScreen from '../src/renderer/src/ResetScreen.vue'
import SetupScreen from '../src/renderer/src/SetupScreen.vue'

type Bridge = Record<string, ReturnType<typeof vi.fn>>
const install = (extra: Bridge = {}) => {
  const bridge: Bridge = {
    unlock: vi.fn(async () => ({ result: 'wrong' })),
    setupLock: vi.fn(async () => ({ ok: true })),
    ...extra
  }
  ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
  return bridge
}
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
const pad = (w: ReturnType<typeof mount>, label: string) => w.findAll('.pad button').find((s) => s.text() === label)!

describe('LockScreen (PIN)', () => {
  let w: ReturnType<typeof mount>
  afterEach(() => w?.unmount())

  it('shows the app name, the hint, six dots and the pad 1-9 / Forgot / 0 / Delete', () => {
    install()
    w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
    expect(w.find('.brand').text()).toBe('GuiseDesk')
    expect(w.find('.hint').text()).toBe('Locked · your accounts are still running')
    expect(w.findAll('.dots i')).toHaveLength(6)
    expect(w.findAll('.pad button').map((s) => s.text())).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Forgot', '0', 'Delete'])
  })

  it('accepts keyboard digits and pad clicks, fills the dots, sends the entry once complete', async () => {
    const b = install({ unlock: vi.fn(async () => ({ result: 'ok' })) })
    w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
    press('1')
    press('2')
    press('x')
    await flushPromises()
    expect(w.findAll('.dots i.f')).toHaveLength(2)
    await pad(w, '3').trigger('click')
    await pad(w, '4').trigger('click')
    await pad(w, 'Delete').trigger('click')
    expect(w.findAll('.dots i.f')).toHaveLength(3)
    press('4')
    press('5')
    expect(b.unlock).not.toHaveBeenCalled()
    press('6')
    await flushPromises()
    expect(b.unlock).toHaveBeenCalledExactlyOnceWith('123456')
  })

  it('wrong entry shakes, clears and says it was wrong until the next digit', async () => {
    install()
    w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
    for (const k of '111111') press(k)
    await flushPromises()
    expect(w.find('.lockv').classes()).toContain('shake')
    expect(w.findAll('.dots i.f')).toHaveLength(0)
    expect(w.find('.wrong').text()).toBe('Wrong PIN. Try again.')
    press('2')
    await flushPromises()
    expect(w.find('.wrong').exists()).toBe(false)
  })

  describe('wait', () => {
    beforeEach(() => vi.useFakeTimers({ now: 5_000_000 }))
    afterEach(() => vi.useRealTimers())

    it('5th wrong try shows a 30 s wait that counts down, ignores input, then frees the pad (fake clock)', async () => {
      const b = install({ unlock: vi.fn(async () => ({ result: 'wait', until: 5_030_000 })) })
      w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
      for (const k of '111111') press(k)
      await flushPromises()
      expect(w.find('.wait').text()).toContain('30 s')
      expect(w.find('.wrong').exists()).toBe(false)
      b.unlock.mockClear()
      for (const k of '222222') press(k)
      await flushPromises()
      expect(b.unlock).not.toHaveBeenCalled()
      vi.setSystemTime(5_012_000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(w.find('.wait').text()).toContain('17 s')
      vi.setSystemTime(5_030_000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(w.find('.wait').exists()).toBe(false)
      press('1')
      await flushPromises()
      expect(w.findAll('.dots i.f')).toHaveLength(1)
    })

    it('starts already waiting when main reports a wait in progress', async () => {
      install()
      w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6, waitUntil: 5_020_000 } })
      expect(w.find('.wait').text()).toContain('20 s')
    })
  })

  it('Forgot emits forgot', async () => {
    install()
    w = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
    await pad(w, 'Forgot').trigger('click')
    expect(w.emitted('forgot')).toHaveLength(1)
  })
})

describe('LockScreen (password)', () => {
  it('names a wrong password and clears the message when typing again', async () => {
    install()
    const w = mount(LockScreen, { props: { kind: 'password' } })
    await w.find('input[type=password]').setValue('wrong-one')
    await w.find('input[type=password]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.find('.wrong').text()).toBe('Wrong password. Try again.')
    await w.find('input[type=password]').setValue('another')
    expect(w.find('.wrong').exists()).toBe(false)
  })

  it('the eye toggles the entry between hidden and visible, and a wrong attempt hides it again (UX-028)', async () => {
    install()
    const w = mount(LockScreen, { props: { kind: 'password' } })
    const eye = w.find('[aria-label="Show password"]')
    expect(eye.attributes('aria-pressed')).toBe('false')
    expect(w.find('input[type=password]').exists()).toBe(true)

    await eye.trigger('click')
    expect(w.find('input[type=text]').exists()).toBe(true)
    const hidden = w.find('[aria-label="Hide password"]')
    expect(hidden.attributes('aria-pressed')).toBe('true')
    await hidden.trigger('click')
    expect(w.find('input[type=password]').exists()).toBe(true)

    await w.find('[aria-label="Show password"]').trigger('click')
    await w.find('input[type=text]').setValue('wrong-one')
    await w.find('input[type=text]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.find('input[type=text]').exists()).toBe(false)
    expect(w.find('input[type=password]').exists()).toBe(true)
    expect(w.find('[aria-label="Show password"]').attributes('aria-pressed')).toBe('false')
  })

  it('shows a field instead of the pad and submits on Enter', async () => {
    const b = install({ unlock: vi.fn(async () => ({ result: 'ok' })) })
    const w = mount(LockScreen, { props: { kind: 'password' } })
    expect(w.find('.pad').exists()).toBe(false)
    await w.find('input[type=password]').setValue('hunter2hunter2')
    await w.find('input[type=password]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(b.unlock).toHaveBeenCalledExactlyOnceWith('hunter2hunter2')
  })
})

describe('Caps Lock hint (UX-029)', () => {
  it('capsLockOn reads getModifierState and treats a missing method as off', () => {
    expect(capsLockOn({ getModifierState: (k: string) => k === 'CapsLock' })).toBe(true)
    expect(capsLockOn({ getModifierState: () => false })).toBe(false)
    expect(capsLockOn({})).toBe(false)
  })

  it('the password field shows the hint on a Caps Lock keydown and hides it on a keyup with it off', async () => {
    install()
    const w = mount(LockScreen, { props: { kind: 'password' } })
    const field = w.find('input[type=password]')
    const withCaps = (type: string, on: boolean) => {
      const e = new KeyboardEvent(type, { key: 'a', bubbles: true })
      Object.defineProperty(e, 'getModifierState', { value: (k: string) => on && k === 'CapsLock' })
      field.element.dispatchEvent(e)
    }
    withCaps('keydown', true)
    await w.vm.$nextTick()
    expect(w.find('.caps').text()).toBe('Caps Lock is on')
    withCaps('keyup', false)
    await w.vm.$nextTick()
    expect(w.find('.caps').exists()).toBe(false)
    w.unmount()
  })

  it('hides the hint after a successful unlock and never shows it on the PIN pad', async () => {
    install({ unlock: vi.fn(async () => ({ result: 'ok' })) })
    const w = mount(LockScreen, { props: { kind: 'password' } })
    const field = w.find('input[type=password]')
    const caps = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    Object.defineProperty(caps, 'getModifierState', { value: (k: string) => k === 'CapsLock' })
    field.element.dispatchEvent(caps)
    await w.vm.$nextTick()
    expect(w.find('.caps').exists()).toBe(true)
    await field.setValue('hunter2hunter2')
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(enter, 'getModifierState', { value: (k: string) => k === 'CapsLock' })
    field.element.dispatchEvent(enter)
    await flushPromises()
    expect(w.find('.caps').exists()).toBe(false)
    const pin = mount(LockScreen, { props: { kind: 'pin', pinLength: 6 } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))
    expect(pin.find('.caps').exists()).toBe(false)
  })
})

describe('SetupScreen', () => {
  const fill = async (w: ReturnType<typeof mount>, a: string, b: string) => {
    const f = w.findAll('input')
    await f[0].setValue(a)
    await f[1].setValue(b)
    await w.find('.btn.pri').trigger('click')
    await flushPromises()
  }

  it('titled "Set a PIN" with a PIN/Password switch; a 5-digit PIN and a mismatch are refused before main is asked', async () => {
    const b = install()
    const w = mount(SetupScreen)
    expect(w.find('h2').text()).toBe('Set a PIN')
    expect(w.findAll('.seg span').map((s) => s.text())).toEqual(['PIN', 'Password'])
    await fill(w, '123', '123')
    expect(w.find('.err').text()).toContain('at least 4')
    await fill(w, '123456', '123457')
    expect(w.find('.err').text()).toBe('The two entries do not match')
    expect(b.setupLock).not.toHaveBeenCalled()
  })

  it('sends a valid PIN once; the Password switch changes the title and the rule', async () => {
    const b = install()
    const w = mount(SetupScreen)
    await fill(w, '123456', '123456')
    expect(b.setupLock).toHaveBeenCalledExactlyOnceWith('pin', '123456', '123456')
    await w.findAll('.seg span')[1].trigger('click')
    expect(w.find('h2').text()).toBe('Set a password')
    await fill(w, 'short', 'short')
    expect(w.find('.err').text()).toContain('at least 8')
  })
})

describe('App while locked', () => {
  const secret = { id: 'a1', serviceId: 'whatsapp', label: 'Secret Shop', colour: '#6d5bd0', order: 0 }
  const base = (state: string) => ({
    lockState: vi.fn(async () => ({ state, kind: 'pin', pinLength: 6 })),
    onLock: vi.fn(),
    state: vi.fn(async () => ({ accounts: [secret], selectedId: 'a1', disabledServices: [] })),
    unread: vi.fn(async () => ({ a1: 7 })),
    onUnread: vi.fn(),
    onSelected: vi.fn(),
    onOpenSettings: vi.fn(),
    sleep: vi.fn(async () => ({})),
    onSleep: vi.fn(),
    onSidebar: vi.fn(),
    onZoom: vi.fn(),
    onLinkChoose: vi.fn(),
    onRowMenuPick: vi.fn(),
    onUpdate: vi.fn(),
    updateState: vi.fn(async () => ({ state: 'none' })),
    select: vi.fn(),
    dialog: vi.fn()
  })

  it('locked: shows the lock screen, never asks for accounts, no label or count in the DOM', async () => {
    const b = install(base('locked'))
    const w = mount(App)
    await flushPromises()
    expect(w.find('.lockv').exists()).toBe(true)
    expect(w.find('.side').exists()).toBe(false)
    expect(w.html()).not.toContain('Secret Shop')
    expect(w.find('.count').exists()).toBe(false)
    expect(b.state).not.toHaveBeenCalled()
    expect(b.unread).not.toHaveBeenCalled()
  })

  it('setup: shows the setup screen and no account data', async () => {
    const b = install(base('setup'))
    const w = mount(App)
    await flushPromises()
    expect(w.find('h2').text()).toBe('Set a PIN')
    expect(b.state).not.toHaveBeenCalled()
  })

  it('locking while unlocked wipes the account list from the DOM; unlocking loads it again', async () => {
    let change: (s: { state: string }) => void = () => {}
    const b = install({ ...base('unlocked'), onLock: vi.fn((cb) => (change = cb)) })
    const w = mount(App)
    await flushPromises()
    expect(w.html()).toContain('Secret Shop')
    change({ state: 'locked' })
    await flushPromises()
    expect(w.html()).not.toContain('Secret Shop')
    expect(w.find('.lockv').exists()).toBe(true)
    b.state.mockClear()
    change({ state: 'unlocked' })
    await flushPromises()
    expect(b.state).toHaveBeenCalled()
    expect(w.html()).toContain('Secret Shop')
  })
})

describe('Reset screen', () => {
  it('Forgot on the lock screen opens the confirm screen, Cancel returns', async () => {
    install({
      lockState: vi.fn(async () => ({ state: 'locked', kind: 'pin', pinLength: 6 })),
      onLock: vi.fn(),
      onSleep: vi.fn(),
      onSidebar: vi.fn(),
      onZoom: vi.fn(),
      onLinkChoose: vi.fn(),
      onRowMenuPick: vi.fn(),
      onUpdate: vi.fn(),
      updateState: vi.fn(async () => ({ state: 'none' })),
      onUnread: vi.fn(),
      onSelected: vi.fn(),
      onOpenSettings: vi.fn()
    })
    const w = mount(App)
    await flushPromises()
    await pad(w, 'Forgot').trigger('click')
    expect(w.find('.reset').exists()).toBe(true)
    expect(w.find('.pad').exists()).toBe(false)
    await w.find('.reset .btn:not(.dng)').trigger('click')
    expect(w.find('.reset').exists()).toBe(false)
    expect(w.find('.pad').exists()).toBe(true)
    w.unmount()
  })

  it('explains what is removed, and Reset stays disabled until RESET is typed exactly', async () => {
    const b = install({ reset: vi.fn(async () => ({ ok: true })) })
    const w = mount(ResetScreen)
    expect(w.text()).toContain('every account and session')
    expect(w.text()).toContain('RESET')
    const btn = w.find('.btn.dng')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    await w.find('input').setValue('reset')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    await btn.trigger('click')
    expect(b.reset).not.toHaveBeenCalled()
    await w.find('input').setValue('RESET')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    await btn.trigger('click')
    await flushPromises()
    expect(b.reset).toHaveBeenCalledExactlyOnceWith('RESET')
  })

  it('shows an error from main', async () => {
    install({ reset: vi.fn(async () => ({ error: 'Refused' })) })
    const w = mount(ResetScreen)
    await w.find('input').setValue('RESET')
    await w.find('.btn.dng').trigger('click')
    await flushPromises()
    expect(w.find('.err').text()).toBe('Refused')
  })

  it('shows an error when the reset call throws', async () => {
    install({ reset: vi.fn(async () => { throw new Error('disk gone') }) })
    const w = mount(ResetScreen)
    await w.find('input').setValue('RESET')
    await w.find('.btn.dng').trigger('click')
    await flushPromises()
    expect(w.find('.err').text()).not.toBe('')
  })
})
