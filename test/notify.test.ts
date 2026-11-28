import { describe, expect, it } from 'vitest'
import { decideNotification, notificationClickTarget, quietOutsideWorkHours } from '../src/main/notify'

const event = {
  accountId: 'a1',
  serviceName: 'WhatsApp',
  label: 'Personal',
  title: 'Alice',
  body: 'Lunch at 12?',
  icon: 'https://example.com/a.png'
}

describe('decideNotification', () => {
  it('returns full with sender, body and service line for a normal account', () => {
    expect(decideNotification(event, {})).toEqual({
      action: 'full',
      accountId: 'a1',
      title: 'Alice',
      body: 'Lunch at 12?',
      subtitle: 'WhatsApp - Personal',
      icon: 'https://example.com/a.png'
    })
  })
  it('takes muted, dnd, asleep and locked flags (all false is the normal path)', () => {
    const off = { muted: false, dnd: false, asleep: false, locked: false }
    expect(decideNotification(event, off).action).toBe('full')
  })
  it('drops a muted account notification', () => {
    expect(decideNotification(event, { muted: true })).toEqual({ action: 'drop' })
  })
  it('drops everything while Do Not Disturb is on, and is normal again when off', () => {
    expect(decideNotification(event, { dnd: true })).toEqual({ action: 'drop' })
    expect(decideNotification(event, { dnd: true, muted: false }).action).toBe('drop')
    expect(decideNotification(event, { dnd: false }).action).toBe('full')
  })
  it('while locked: GuiseDesk / New message, no sender, body, account or icon', () => {
    const d = decideNotification(event, { locked: true })
    expect(d).toEqual({ action: 'generic', accountId: 'a1', title: 'GuiseDesk', body: 'New message', subtitle: '' })
    const text = JSON.stringify(d)
    for (const secret of ['Alice', 'Lunch', 'WhatsApp', 'Personal', 'example.com']) expect(text).not.toContain(secret)
  })
  it('locked still drops a muted account and DND', () => {
    expect(decideNotification(event, { locked: true, muted: true })).toEqual({ action: 'drop' })
    expect(decideNotification(event, { locked: true, dnd: true })).toEqual({ action: 'drop' })
  })
})

describe('quiet outside work hours (D58)', () => {
  const sched = {
    on: true,
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '17:00',
    workMinutes: 15,
    offMinutes: 480,
    count: 'unlock' as const
  }
  const at = (day: number, hour: number) => new Date(2026, 0, day, hour, 0)

  it('is off when the switch is off, at any time', () => {
    expect(quietOutsideWorkHours(false, sched, at(5, 20))).toBe(false)
    expect(quietOutsideWorkHours(false, sched, at(5, 10))).toBe(false)
  })

  it('is on only outside the schedule days and hours', () => {
    expect(quietOutsideWorkHours(true, sched, at(5, 10))).toBe(false)
    expect(quietOutsideWorkHours(true, sched, at(5, 20))).toBe(true)
    expect(quietOutsideWorkHours(true, sched, at(3, 10))).toBe(true)
  })

  it('drops notifications like DND without touching the muted or locked rules', () => {
    expect(decideNotification(event, { quiet: true })).toEqual({ action: 'drop' })
    expect(decideNotification(event, { quiet: true, muted: false }).action).toBe('drop')
    expect(decideNotification(event, { quiet: false }).action).toBe('full')
    expect(decideNotification(event, { quiet: true, locked: true })).toEqual({ action: 'drop' })
  })
})

describe('notification click target (UX-042)', () => {
  it('selects the account normally and asks for Settings > Services when its service is off', () => {
    expect(notificationClickTarget(false)).toBe('select')
    expect(notificationClickTarget(true)).toBe('services')
  })
})
