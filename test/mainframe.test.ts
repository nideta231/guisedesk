import { afterEach, describe, expect, it, vi } from 'vitest'
import { onceMainFrameSettled } from '../src/main/mainframe'

type Listener = (...args: any[]) => void

function emitter() {
  const listeners = new Map<string, Listener[]>()
  return {
    on(event: string, fn: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
    },
    removeListener(event: string, fn: Listener) {
      listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== fn))
    },
    emit(event: string, ...args: any[]) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args)
    },
    count(event: string) {
      return (listeners.get(event) ?? []).length
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('onceMainFrameSettled (BG-017)', () => {
  it('ignores a did-fail-load for a subframe and wakes on a main-frame load', () => {
    vi.useFakeTimers()
    const wc = emitter()
    const done = vi.fn()
    onceMainFrameSettled(wc, done, 60_000)

    wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://ads.example/frame', false, 2, 3)
    expect(done).not.toHaveBeenCalled()
    expect(wc.count('did-finish-load')).toBe(1)

    wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://site.example/', true, 1, 2)
    expect(done).toHaveBeenCalledOnce()
    expect(wc.count('did-fail-load')).toBe(0)
    expect(wc.count('did-finish-load')).toBe(0)
  })

  it('calls done once for a main-frame failure and ignores a later finish', () => {
    vi.useFakeTimers()
    const wc = emitter()
    const done = vi.fn()
    onceMainFrameSettled(wc, done, 60_000)

    wc.emit('did-fail-load', {}, -2, 'FAILED', 'https://site.example/', true, 1, 2)
    wc.emit('did-finish-load')
    wc.emit('did-fail-load', {}, -2, 'FAILED', 'https://site.example/', true, 1, 2)
    expect(done).toHaveBeenCalledOnce()
  })

  it('wakes on did-finish-load and the timeout keeps the wake from hanging', () => {
    vi.useFakeTimers()
    const wc = emitter()
    const first = vi.fn()
    onceMainFrameSettled(wc, first, 60_000)
    wc.emit('did-finish-load')
    expect(first).toHaveBeenCalledOnce()

    const second = vi.fn()
    onceMainFrameSettled(wc, second, 5_000)
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)
    expect(second).toHaveBeenCalledOnce()
  })
})
