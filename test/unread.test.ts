import { describe, expect, it, vi } from 'vitest'
import { formatCount, parseUnread, totalUnread, updateWindowTitle, windowTitle, without } from '../src/main/unread'
import { presetFor } from '../src/main/presets'

describe('parseUnread', () => {
  it('reads the count in parentheses', () => {
    expect(parseUnread('(3) WhatsApp', presetFor('whatsapp'))).toBe(3)
    expect(parseUnread('(12) Instagram', presetFor('instagram'))).toBe(12)
  })
  it('counts a Discord bullet title as one unread', () => {
    expect(parseUnread('• Discord | #general', presetFor('discord'))).toBe(1)
  })
  it('returns 0 without a count', () => {
    expect(parseUnread('WhatsApp', presetFor('whatsapp'))).toBe(0)
    expect(parseUnread('', undefined)).toBe(0)
    expect(parseUnread('• Some page', undefined)).toBe(0)
    expect(parseUnread('Room (3) of 5', undefined)).toBe(0)
  })
  it('treats 99+ as more than 99 and displays it as 99+', () => {
    expect(parseUnread('(99+) WhatsApp', presetFor('whatsapp'))).toBe(100)
    expect(formatCount(100)).toBe('99+')
    expect(formatCount(99)).toBe('99')
    expect(formatCount(7)).toBe('7')
  })
  it('sums the per-account counts for the tray', () => {
    expect(totalUnread({ a: 3, b: 0, c: 12 })).toBe(15)
    expect(totalUnread({})).toBe(0)
  })
  it('leaves switched-off services out when the enabled ids are given', () => {
    expect(totalUnread({ a: 2, b: 5 }, ['a'])).toBe(2)
    expect(totalUnread({ a: 2, b: 5 }, [])).toBe(0)
    expect(totalUnread({ a: 2, b: 5 })).toBe(7)
  })
  it('without drops just the logged-out account and leaves the rest', () => {
    const counts = { a: 3, b: 0, c: 12 }
    expect(without(counts, 'c')).toEqual({ a: 3, b: 0 })
    expect(counts).toEqual({ a: 3, b: 0, c: 12 })
    expect(without({}, 'a')).toEqual({})
  })
})

describe('window title (UX-011)', () => {
  it('carries the unread total while unlocked and stays plain while locked', () => {
    expect(windowTitle(3, false)).toBe('(3) GuiseDesk')
    expect(windowTitle(0, false)).toBe('GuiseDesk')
    expect(windowTitle(3, true)).toBe('GuiseDesk')
    expect(windowTitle(0, true)).toBe('GuiseDesk')
  })

  it('sets the title on the window, as push does', () => {
    const win = { setTitle: vi.fn() }
    expect(updateWindowTitle(win, 7, false)).toBe('(7) GuiseDesk')
    expect(win.setTitle).toHaveBeenCalledExactlyOnceWith('(7) GuiseDesk')
    updateWindowTitle(win, 7, true)
    expect(win.setTitle).toHaveBeenLastCalledWith('GuiseDesk')
  })
})
