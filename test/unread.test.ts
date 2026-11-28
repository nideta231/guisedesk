import { describe, expect, it } from 'vitest'
import { formatCount, parseUnread, totalUnread, without } from '../src/main/unread'
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
  it('without drops just the logged-out account and leaves the rest', () => {
    const counts = { a: 3, b: 0, c: 12 }
    expect(without(counts, 'c')).toEqual({ a: 3, b: 0 })
    expect(counts).toEqual({ a: 3, b: 0, c: 12 })
    expect(without({}, 'a')).toEqual({})
  })
})
