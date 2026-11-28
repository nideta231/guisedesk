// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TopBar from '../src/renderer/src/TopBar.vue'
import { createBlockState, hostOf, shieldMenuItems } from '../src/main/blockstate'

const wa = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#2f9e6e', order: 1 }

describe('TopBar blocking chips', () => {
  it('the shield count shows only while ad blocking is on', () => {
    const on = mount(TopBar, { props: { account: wa, asleep: false, adsOn: true, blocked: 12 } })
    expect(on.find('.chip.shield').text()).toBe('12')
    expect(on.find('.chip.shield').attributes('title')).toBe('Ads and trackers blocked')
    expect(mount(TopBar, { props: { account: wa, asleep: false, adsOn: false, blocked: 12 } }).find('.chip.shield').exists()).toBe(false)
    expect(mount(TopBar, { props: { account: wa, asleep: false } }).find('.chip.shield').exists()).toBe(false)
  })
  it('"Pop-up blocked" shows for a dropped pop-up and clicking it asks to open it anyway', async () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false, popup: 'https://shop.example/pay' } })
    const chip = w.find('.chip.popup')
    expect(chip.text()).toBe('Pop-up blocked')
    expect(chip.attributes('title')).toBe('Open anyway: https://shop.example/pay')
    await chip.trigger('click')
    expect(w.emitted('open-popup')).toHaveLength(1)
    expect(mount(TopBar, { props: { account: wa, asleep: false } }).find('.chip.popup').exists()).toBe(false)
  })
})

describe('block state', () => {
  it('open anyway hands back the dropped URL once and clears the chip; navigation resets the count', () => {
    vi.useFakeTimers()
    const changed = vi.fn()
    const s = createBlockState(changed)
    s.blocked('a'); s.blocked('a')
    vi.advanceTimersByTime(300)
    expect(s.snapshot().a.blocked).toBe(2)
    s.popup('a', 'https://x/p')
    expect(s.take('a')).toBe('https://x/p')
    expect(s.take('a')).toBeUndefined()
    expect(s.snapshot().a.popup).toBeUndefined()
    s.popup('a', 'https://x/q')
    s.navigated('a')
    expect(s.snapshot().a).toMatchObject({ blocked: 0, total: 2, popups: 2, hosts: {} })
    expect(s.snapshot().a.popup).toBeUndefined()
    expect(changed).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('reset clears block state', () => {
  it('drops every account count, host and dropped pop-up', () => {
    const s = createBlockState(() => {})
    s.blocked('a', 'https://ads.example/x')
    s.popup('a', 'https://shop.example/pay?token=1')
    expect(s.snapshot().a.blocked).toBe(1)
    s.clear()
    expect(s.snapshot()).toEqual({})
  })
})

describe('logout forgets one account', () => {
  it('forget removes that account from the snapshot and leaves the others', () => {
    const s = createBlockState(() => {})
    s.blocked('a', 'https://ads.example/x')
    s.popup('a', 'https://shop.example/pay')
    s.blocked('b', 'https://ads.example/y')
    s.forget('a')
    expect(Object.keys(s.snapshot())).toEqual(['b'])
    expect(s.snapshot().b.blocked).toBe(1)
  })
})

describe('shield menu', () => {
  it('clicking the shield emits shield', async () => {
    const w = mount(TopBar, { props: { account: wa, asleep: false, adsOn: true, blocked: 3 } })
    await w.find('.chip.shield').trigger('click')
    expect(w.emitted('shield')).toHaveLength(1)
  })
  it('lists page, session and pop-up counts, the top hosts and the actions', () => {
    vi.useFakeTimers()
    const s = createBlockState(() => {})
    for (const u of ['https://www.doubleclick.net/a', 'https://doubleclick.net/b', 'https://ads.x.com/c']) s.blocked('a', u)
    s.popup('a', 'https://p/')
    const labels = shieldMenuItems(s.get('a'), true).filter((i) => !i.separator).map((i) => i.label)
    expect(labels).toEqual(['Ad blocking is on', 'This page: 3 requests blocked', 'Since GuiseDesk started: 3', 'Pop-ups blocked: 1',
      'Most blocked on this page', 'doubleclick.net  ·  2', 'ads.x.com  ·  1', 'Open blocked pop-up', 'Blocking settings...'])
    expect(shieldMenuItems(undefined, true).map((i) => i.label)).toContain('This page: 0 requests blocked')
    expect(hostOf('nope')).toBe('nope')
    vi.useRealTimers()
  })
})
