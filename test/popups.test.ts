import { describe, expect, it, vi } from 'vitest'
import { createPopups, openTarget } from '../src/main/popups'
import { closePartitionPopups } from '../src/main/sharing'

describe('openTarget', () => {
  const table: [string, 'in-app' | 'external' | 'deny', string][] = [
    ['background-tab', 'in-app', 'popup'],
    ['foreground-tab', 'in-app', 'popup'],
    ['new-window', 'in-app', 'same-view'],
    ['default', 'in-app', 'same-view'],
    ['other', 'in-app', 'same-view'],
    ['background-tab', 'external', 'external'],
    ['foreground-tab', 'external', 'external'],
    ['new-window', 'external', 'external'],
    ['default', 'external', 'external'],
    ['background-tab', 'deny', 'deny'],
    ['foreground-tab', 'deny', 'deny'],
    ['default', 'deny', 'deny']
  ]
  it.each(table)('%s + %s -> %s', (disposition, action, want) => {
    expect(openTarget(disposition, action)).toBe(want)
  })
})

describe('closePartitionPopups', () => {
  it('closes the host and every account sharing its login, once each, and no other account', () => {
    const closeFor = vi.fn()
    const accounts = [{ id: 'host' }, { id: 'sharer', shareWith: 'host' }, { id: 'other' }]
    closePartitionPopups(accounts[0], accounts, closeFor)
    expect(closeFor.mock.calls.map((c) => c[0])).toEqual(['host', 'sharer'])
  })
})

describe('popup registry', () => {
  const make = () => {
    const closed: string[] = []
    const reg = createPopups<string>((w) => closed.push(w))
    return { closed, reg }
  }
  it('closeFor closes only that account', () => {
    const { closed, reg } = make()
    reg.add('a', 'a1')
    reg.add('a', 'a2')
    reg.add('b', 'b1')
    reg.closeFor('a')
    expect(closed).toEqual(['a1', 'a2'])
    expect(reg.count()).toBe(1)
  })
  it('closeAll closes everything', () => {
    const { closed, reg } = make()
    reg.add('a', 'a1')
    reg.add('b', 'b1')
    reg.closeAll()
    expect(closed.sort()).toEqual(['a1', 'b1'])
    expect(reg.count()).toBe(0)
  })
  it('forgets a window that closed itself', () => {
    const { closed, reg } = make()
    reg.add('a', 'a1')
    reg.add('a', 'a2')
    reg.forget('a1')
    reg.closeFor('a')
    expect(closed).toEqual(['a2'])
  })
})
