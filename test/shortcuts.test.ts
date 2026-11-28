// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { isSettingsShortcut, nextZoom, SHORTCUTS, switchTarget, zoomKey, zoomPercent } from '../src/main/shortcuts'
import ShortcutHelp from '../src/renderer/src/ShortcutHelp.vue'
import { sidebarOrder } from '../src/main/services'

const k = (key: string, over: Record<string, unknown> = {}) => ({ type: 'keyDown', key, control: true, shift: false, alt: false, meta: false, ...over })

describe('zoomKey', () => {
  it('maps Ctrl+= Ctrl++ Ctrl+- Ctrl+0 and numpad keys', () => {
    expect(zoomKey(k('='))).toBe('in')
    expect(zoomKey(k('+', { shift: true }))).toBe('in')
    expect(zoomKey(k('+', { code: 'NumpadAdd' }))).toBe('in')
    expect(zoomKey(k('-'))).toBe('out')
    expect(zoomKey(k('-', { code: 'NumpadSubtract' }))).toBe('out')
    expect(zoomKey(k('0'))).toBe('reset')
    expect(zoomKey(k('0', { code: 'Numpad0' }))).toBe('reset')
  })
  it('ignores other keys, missing Ctrl, alt, meta and key-up', () => {
    expect(zoomKey(k('a'))).toBeNull()
    expect(zoomKey(k('=', { control: false }))).toBeNull()
    expect(zoomKey(k('=', { alt: true }))).toBeNull()
    expect(zoomKey(k('=', { meta: true }))).toBeNull()
    expect(zoomKey(k('=', { type: 'keyUp' }))).toBeNull()
  })
})

describe('nextZoom', () => {
  it('steps by 0.5 and clamps to -3..5', () => {
    expect(nextZoom(0, 'in')).toBe(0.5)
    expect(nextZoom(0, 'out')).toBe(-0.5)
    expect(nextZoom(5, 'in')).toBe(5)
    expect(nextZoom(-3, 'out')).toBe(-3)
    expect(nextZoom(2, 'reset')).toBe(0)
  })
  it('zoomPercent is round(100 * 1.2^level)', () => {
    expect(zoomPercent(0)).toBe(100)
    expect(zoomPercent(1)).toBe(120)
    expect(zoomPercent(-1)).toBe(83)
    expect(zoomPercent(0.5)).toBe(110)
  })
})

const ids = ['a', 'b', 'c']
const tab = (over: Record<string, unknown> = {}) => k('Tab', over)

describe('switchTarget', () => {
  it('Ctrl+1..9 picks the nth id, null when there is none', () => {
    expect(switchTarget(k('1'), ids, 'c')).toBe('a')
    expect(switchTarget(k('3'), ids, 'a')).toBe('c')
    expect(switchTarget(k('4'), ids, 'a')).toBeNull()
    expect(switchTarget(k('9'), ids, 'a')).toBeNull()
    expect(switchTarget(k('1'), [], undefined)).toBeNull()
  })
  it('Ctrl+Tab goes next and Ctrl+Shift+Tab previous, both wrapping', () => {
    expect(switchTarget(tab(), ids, 'a')).toBe('b')
    expect(switchTarget(tab(), ids, 'c')).toBe('a')
    expect(switchTarget(tab({ shift: true }), ids, 'b')).toBe('a')
    expect(switchTarget(tab({ shift: true }), ids, 'a')).toBe('c')
  })
  it('with no (or unknown) selection next gives the first and previous the last; no ids gives null', () => {
    expect(switchTarget(tab(), ids, undefined)).toBe('a')
    expect(switchTarget(tab(), ids, 'zzz')).toBe('a')
    expect(switchTarget(tab({ shift: true }), ids, undefined)).toBe('c')
    expect(switchTarget(tab(), [], undefined)).toBeNull()
  })
  it('needs Ctrl alone: no Ctrl, Alt, Meta, key-up, Shift on a digit or other keys', () => {
    expect(switchTarget(k('2', { control: false }), ids, 'a')).toBeNull()
    expect(switchTarget(k('2', { alt: true }), ids, 'a')).toBeNull()
    expect(switchTarget(k('2', { meta: true }), ids, 'a')).toBeNull()
    expect(switchTarget(k('2', { type: 'keyUp' }), ids, 'a')).toBeNull()
    expect(switchTarget(k('2', { shift: true }), ids, 'a')).toBeNull()
    expect(switchTarget(tab({ alt: true }), ids, 'a')).toBeNull()
    expect(switchTarget(k('0'), ids, 'a')).toBeNull()
    expect(switchTarget(k('x'), ids, 'a')).toBeNull()
  })
})

describe('sidebarOrder', () => {
  it('is Chats then Feeds, each by order', () => {
    const mk = (id: string, serviceId: string, order: number) => ({ id, serviceId, order })
    const list = [mk('ig', 'instagram', 0), mk('wa2', 'whatsapp', 3), mk('dc', 'discord', 2), mk('wa1', 'whatsapp', 1)]
    expect(sidebarOrder(list).map((a) => a.id)).toEqual(['wa1', 'dc', 'wa2', 'ig'])
  })
})

describe('isSettingsShortcut (UX-036)', () => {
  it('is true only for a Ctrl+, keyDown; a plain comma, key-up, Alt or Meta do not count', () => {
    expect(isSettingsShortcut(k(','))).toBe(true)
    expect(isSettingsShortcut(k(',', { control: false }))).toBe(false)
    expect(isSettingsShortcut(k(',', { type: 'keyUp' }))).toBe(false)
    expect(isSettingsShortcut(k(',', { alt: true }))).toBe(false)
    expect(isSettingsShortcut(k(',', { meta: true }))).toBe(false)
    expect(isSettingsShortcut(k('.'))).toBe(false)
  })

  it('the cheat sheet lists and renders the Ctrl+, Settings row', () => {
    expect(SHORTCUTS.find((s) => s.keys === 'Ctrl+,')).toMatchObject({ group: 'Window', title: 'Settings' })
    const w = mount(ShortcutHelp)
    expect(w.findAll('.hrow').some((r) => r.text().includes('Ctrl+,') && r.text().includes('Settings'))).toBe(true)
  })
})
