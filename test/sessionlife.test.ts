import { describe, expect, it } from 'vitest'
import { flushSessionOnce, flushSessions, flushThenClose, sessionKeys } from '../src/main/sessionlife'

function fakeSession(order: string[]) {
  return {
    cookies: { flushStore: async () => { order.push('flush') } },
    flushStorageData: () => { order.push('storage') }
  }
}

describe('sessionKeys', () => {
  it('keeps sleeping accounts and collapses a shared login to its host once', () => {
    expect(sessionKeys([{ id: 'host' }, { id: 'sharer', shareWith: 'host' }, { id: 'asleep' }])).toEqual(['host', 'asleep'])
  })
})

describe('flushSessions', () => {
  it('flushes a shared login once and includes a partition with no live view', async () => {
    const calls: string[] = []
    const order: string[] = []
    const accounts = [{ id: 'host' }, { id: 'sharer', shareWith: 'host' }, { id: 'asleep' }]
    await flushSessions(sessionKeys(accounts), (key) => {
      calls.push(key)
      return fakeSession(order)
    }, 500)
    expect(calls).toEqual(['host', 'asleep'])
    expect(order).toEqual(['storage', 'flush', 'storage', 'flush'])
  })

  it('resolves only after every flushStore promise settles', async () => {
    const pending: (() => void)[] = []
    let resolved = false
    const session = () => ({
      cookies: { flushStore: () => new Promise<void>((r) => pending.push(r)) },
      flushStorageData: () => {}
    })
    const run = flushSessions(['a', 'b'], session, 500).then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(pending).toHaveLength(2)
    pending.forEach((done) => done())
    await run
    expect(resolved).toBe(true)
  })
})

describe('flushSessionOnce', () => {
  it('does not flush the same session twice when both callers share the seen set', async () => {
    const order: string[] = []
    const ses = fakeSession(order)
    const seen = new WeakSet<object>()
    await flushSessionOnce(ses, seen)
    await flushSessionOnce(ses, seen)
    expect(order).toEqual(['storage', 'flush'])
  })
})

describe('flushThenClose', () => {
  it('flushes the view session before closing it and does not flush twice for one session', async () => {
    const order: string[] = []
    const view = { webContents: { session: fakeSession(order), close: () => { order.push('close') } } }
    const seen = new WeakSet<object>()
    await flushThenClose(view, seen)
    await flushThenClose(view, seen)
    expect(order).toEqual(['storage', 'flush', 'close', 'close'])
  })
})
