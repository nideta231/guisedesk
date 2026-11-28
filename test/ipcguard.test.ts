import { describe, expect, it, vi } from 'vitest'
import { appOnly, createGuardedIpc } from '../src/main/guard'

function fakeIpc() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  const listeners = new Map<string, (...a: unknown[]) => void>()
  return {
    handlers,
    listeners,
    ipc: {
      removeHandler: (c: string) => void handlers.delete(c),
      handle: (c: string, f: (...a: unknown[]) => unknown) => void handlers.set(c, f),
      removeAllListeners: (c: string) => void listeners.delete(c),
      on: (c: string, f: (...a: unknown[]) => void) => void listeners.set(c, f)
    }
  }
}

const sender = (id: number) => ({ sender: { id } })

describe('appOnly', () => {
  it('passes the app window id and refuses another sender without calling fn', () => {
    const fn = vi.fn((id: string) => `ran ${id}`)
    const only = appOnly((e: { sender: { id: number } }) => e.sender.id === 1, fn)

    expect(only(sender(1), 'a1')).toBe('ran a1')
    expect(fn).toHaveBeenCalledWith('a1')
    expect(only(sender(2), 'a1')).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('accounts:select guard', () => {
  it('does not run while locked, and ignores a non-app sender once unlocked', () => {
    const { ipc, listeners } = fakeIpc()
    let unlocked = false
    const g = createGuardedIpc(ipc, () => unlocked)
    const select = vi.fn()
    g.on('accounts:select', appOnly((e: { sender: { id: number } }) => e.sender.id === 1, select))

    listeners.get('accounts:select')!(sender(1), 'a1')
    expect(select).not.toHaveBeenCalled()

    unlocked = true
    listeners.get('accounts:select')!(sender(2), 'a1')
    expect(select).not.toHaveBeenCalled()

    listeners.get('accounts:select')!(sender(1), 'a1')
    expect(select).toHaveBeenCalledWith('a1')
  })
})
