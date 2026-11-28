// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App.vue'
import TopBar from '../src/renderer/src/TopBar.vue'
import { panelBounds, TOP_BAR_H, TOP_BAR_GAP, PAD_TOP } from '../src/main/layout'
import { goBack, goForward, navState } from '../src/main/nav'
import { homeUrl } from '../src/main/servicelinks'
import { appOnly } from '../src/main/guard'

const wa = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#2f9e6e', order: 1 }
const ig = { id: 'ig1', serviceId: 'instagram', label: 'Shop', colour: '#b04c7a', order: 2 }

describe('TopBar', () => {
  it('shows bold label, muted service and the chip for live chat / asleep / muted / live feed', () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false } })
    expect(w.find('.title').text()).toBe('Personal · WhatsApp')
    expect(w.find('.title').element.childNodes[0].textContent).toBe('Personal ')
    expect(w.find('.title span').text()).toBe('· WhatsApp')
    expect(w.find('.chip').text()).toBe('Always on')
    expect(w.find('.chip').classes()).toContain('live')
    const asleep = mount(TopBar, { props: { account: ig, asleep: true } })
    expect(asleep.find('.chip').text()).toBe('Asleep')
    expect(asleep.find('.chip').classes()).not.toContain('live')
    const muted = mount(TopBar, { props: { account: { ...wa, muted: true }, asleep: false } })
    expect(muted.find('.chip').text()).toBe('Muted')
    expect(muted.find('.chip').classes()).not.toContain('live')
    expect(mount(TopBar, { props: { account: ig, asleep: false } }).find('.chip').exists()).toBe(false)
    // an always-on override on a feed account counts
    expect(mount(TopBar, { props: { account: { ...ig, idlePolicy: 'always' }, asleep: false } }).find('.chip').text()).toBe('Always on')
  })

  it('Reload, Mute, Lock and Settings buttons emit their actions; bell-off when muted', async () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false } })
    const b = w.findAll('.actions .ib')
    expect(b).toHaveLength(5)
    for (const x of b) await x.trigger('click')
    expect(w.emitted('reload')).toHaveLength(1)
    expect(w.emitted('mute')).toEqual([[true]])
    expect(w.emitted('lock')).toHaveLength(1)
    expect(w.emitted('settings')).toHaveLength(1)
    const m = mount(TopBar, { props: { account: { ...wa, muted: true }, asleep: false } })
    expect(m.find('[aria-label="Unmute"]').exists()).toBe(true)
    await m.find('[aria-label="Unmute"]').trigger('click')
    expect(m.emitted('mute')).toEqual([[false]])
  })
})

describe('TopBar Sleep now', () => {
  it('shows a Sleep now button left of Lock only when awake, and emits sleep', async () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false } })
    const labels = w.findAll('.actions .ib').map((b) => b.attributes('aria-label'))
    expect(labels.indexOf('Sleep now')).toBe(labels.indexOf('Lock now') - 1)
    expect(w.find('[aria-label="Sleep now"]').attributes('title')).toBe('Sleep now')
    await w.find('[aria-label="Sleep now"]').trigger('click')
    expect(w.emitted('sleep')).toHaveLength(1)
    expect(mount(TopBar, { props: { account: wa, asleep: true } }).find('[aria-label="Sleep now"]').exists()).toBe(false)
  })
})

describe('layout with the bar', () => {
  it('panel bounds move down by the bar height in both sidebar modes', () => {
    expect([TOP_BAR_H, TOP_BAR_GAP]).toEqual([34, 12])
    expect(panelBounds(1240, 780, false)).toEqual({ x: 248, y: PAD_TOP + 46, width: 976, height: 780 - 12 - 46 - 16 })
    expect(panelBounds(1240, 780, true)).toEqual({ x: 80, y: 58, width: 1144, height: 706 })
  })
})

async function app(over: Record<string, unknown> = {}, lock = 'unlocked') {
  const g = {
    lockState: async () => ({ state: lock }),
    onLock: () => {},
    state: async () => ({ accounts: [wa, ig], selectedId: 'wa1', disabledServices: [] }),
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
    onUpdate: () => {},
    updateState: async () => ({ state: 'none' }),
    select: vi.fn(),
    dialog: vi.fn(),
    lock: vi.fn(),
    reload: vi.fn(),
    sleepNow: vi.fn(),
    mute: vi.fn(async () => ({ accounts: [{ ...wa, muted: true }, ig], selectedId: 'wa1', disabledServices: [] })),
    ...over
  }
  ;(window as unknown as { guisedesk: unknown }).guisedesk = g
  const w = mount(App)
  await flushPromises()
  return { w, g }
}

describe('App top bar', () => {
  it('buttons call the bridge: reload, mute flips the shared flag, lock, Settings opens the sheet', async () => {
    const { w, g } = await app()
    expect(w.find('.top .title').text()).toBe('Personal · WhatsApp')
    const b = w.findAll('.top .actions .ib')
    await b[0].trigger('click')
    expect(g.reload).toHaveBeenCalledWith('wa1')
    await b[1].trigger('click')
    await flushPromises()
    expect(g.mute).toHaveBeenCalledWith('wa1', true)
    expect(w.find('.top .chip').text()).toBe('Muted')
    await b[2].trigger('click')
    expect(g.sleepNow).toHaveBeenCalledWith('wa1')
    await b[3].trigger('click')
    expect(g.lock).toHaveBeenCalled()
    await b[4].trigger('click')
    expect(w.find('.top .actions').exists()).toBe(false)
    expect(w.findComponent({ name: 'AccountSheet' }).exists()).toBe(true)
  })

  it('is not rendered while locked or in Settings, and shows Asleep for a sleeping account', async () => {
    expect((await app({}, 'locked')).w.find('.top .actions').exists()).toBe(false)
    const { w } = await app({ sleep: async () => ({ wa1: { minutes: 30, waking: false } }) })
    expect(w.find('.top .chip').text()).toBe('Asleep')
  })
})

describe('TopBar zoom chip', () => {
  it('shows NNN% only when zoomed, and a click emits reset-zoom', async () => {
    expect(mount(TopBar, { props: { account: wa, asleep: false } }).find('.zoom').exists()).toBe(false)
    expect(mount(TopBar, { props: { account: { ...wa, zoom: 0 }, asleep: false } }).find('.zoom').exists()).toBe(false)
    const w = mount(TopBar, { props: { account: { ...wa, zoom: 1 }, asleep: false } })
    expect(w.find('.zoom').text()).toBe('120%')
    expect(w.find('.zoom').attributes('title')).toBe('Reset zoom')
    await w.find('.zoom').trigger('click')
    expect(w.emitted('reset-zoom')).toHaveLength(1)
  })
})

describe('TopBar lock countdown chip (D57)', () => {
  it('shows a short one-line label with a lock icon, hides without a rule, and opens the native menu on click', async () => {
    expect(mount(TopBar, { props: { account: wa, asleep: false, lock: null } }).find('.locks').exists()).toBe(false)
    const w = mount(TopBar, { props: { account: wa, asleep: false, lock: { ms: 11.4 * 60_000, rule: 'Work hours: 15 min after unlock' } } })
    expect(w.find('.locks').text()).toBe('12 min')
    expect(w.find('.locks').text()).not.toContain('Locks in')
    expect(w.find('.locks').classes()).toContain('nowrap')
    expect(w.find('.locks .locki').exists()).toBe(true)
    expect(w.find('.locks').attributes('title')).toBe('Work hours: 15 min after unlock')
    await w.find('.locks').trigger('click')
    expect(w.emitted('lock-menu')).toHaveLength(1)
  })
})

describe('App lock countdown', () => {
  it('takes the countdown from main and sends the chip click back as lockMenu', async () => {
    const lockMenu = vi.fn()
    const { w } = await app({
      lockCountdown: async () => ({ ms: 5 * 60_000, rule: 'Idle: 10 min without use' }),
      lockMenu
    })
    expect(w.find('.top .locks').text()).toBe('5 min')
    expect(w.find('.top .locks').classes()).toContain('nowrap')
    expect(w.find('.top .locks').attributes('title')).toBe('Idle: 10 min without use')
    await w.find('.top .locks').trigger('click')
    expect(lockMenu).toHaveBeenCalled()
  })
})

describe('TopBar Home (UX-014)', () => {
  it('homeUrl picks the preset start page, a custom URL, or nothing', () => {
    expect(homeUrl({ serviceId: 'whatsapp' })).toBe('https://web.whatsapp.com/')
    expect(homeUrl({ serviceId: 'custom', custom: { url: 'https://wiki.example/' } })).toBe('https://wiki.example/')
    expect(homeUrl({ serviceId: 'custom' })).toBeNull()
    expect(homeUrl({ serviceId: 'unknown' })).toBeNull()
  })

  it('the Home button emits home and App forwards it with the account id', async () => {
    const home = vi.fn()
    const { w } = await app({ home })
    await w.find('[aria-label="Home"]').trigger('click')
    expect(home).toHaveBeenCalledExactlyOnceWith('wa1')
  })

  it('the main home handler refuses a non-app sender', () => {
    const load = vi.fn()
    const run = appOnly((e: { sender: { id: number } }) => e.sender.id === 1, (id: string) => load(id))
    run({ sender: { id: 2 } }, 'wa1')
    expect(load).not.toHaveBeenCalled()
    run({ sender: { id: 1 } }, 'wa1')
    expect(load).toHaveBeenCalledExactlyOnceWith('wa1')
  })
})

describe('TopBar Back and Forward (UX-013)', () => {
  it('shows both disabled without history, enabled with it, and emits the direction', async () => {
    const off = mount(TopBar, { props: { account: wa, asleep: false, nav: { canBack: false, canForward: false } } })
    const b0 = off.find('[aria-label="Back"]')
    const f0 = off.find('[aria-label="Forward"]')
    expect(b0.attributes('disabled')).toBeDefined()
    expect(f0.attributes('disabled')).toBeDefined()
    expect(b0.element.compareDocumentPosition(off.find('[aria-label="Reload"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const on = mount(TopBar, { props: { account: wa, asleep: false, nav: { canBack: true, canForward: true } } })
    expect(on.find('[aria-label="Back"]').attributes('disabled')).toBeUndefined()
    expect(on.find('[aria-label="Forward"]').attributes('disabled')).toBeUndefined()
    await on.find('[aria-label="Back"]').trigger('click')
    await on.find('[aria-label="Forward"]').trigger('click')
    expect(on.emitted('back')).toHaveLength(1)
    expect(on.emitted('forward')).toHaveLength(1)
  })

  it('App passes main history to the bar and sends a click back to the bridge', async () => {
    let navPush: (s: { id: string; canBack: boolean; canForward: boolean }) => void = () => {}
    const back = vi.fn()
    const forward = vi.fn()
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
      onNavState: (cb: typeof navPush) => (navPush = cb),
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      select: vi.fn(),
      dialog: vi.fn(),
      reload: vi.fn(),
      back,
      forward
    }
    const w = mount(App)
    await flushPromises()
    expect(w.find('[aria-label="Back"]').attributes('disabled')).toBeDefined()
    navPush({ id: 'wa1', canBack: true, canForward: false })
    await flushPromises()
    expect(w.find('[aria-label="Back"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[aria-label="Forward"]').attributes('disabled')).toBeDefined()
    await w.find('[aria-label="Back"]').trigger('click')
    expect(back).toHaveBeenCalledWith('wa1')
    expect(forward).not.toHaveBeenCalled()
  })

  it('fake main history goes back only for the app sender and never past the end', () => {
    const h = { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
    const run = appOnly((e: { sender: { id: number } }) => e.sender.id === 1, () => goBack(h))
    run({ sender: { id: 2 } })
    expect(h.goBack).not.toHaveBeenCalled()
    run({ sender: { id: 1 } })
    expect(h.goBack).toHaveBeenCalledOnce()
    expect(goForward(h)).toBe(false)
    expect(h.goForward).not.toHaveBeenCalled()
    expect(navState(h)).toEqual({ canBack: true, canForward: false })
  })
})
