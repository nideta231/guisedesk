import { describe, expect, it, vi } from 'vitest'
import { watchViewHealth } from '../src/main/viewhealth'

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

function harness() {
  const tasks: (() => void)[] = []
  const reload = vi.fn()
  const notify = vi.fn()
  const log = vi.fn()
  let t = 1_000_000
  const wc = emitter()
  const watch = (extra: { maxReloads?: number } = {}) =>
    watchViewHealth(wc, {
      reload,
      notify,
      log,
      now: () => t,
      schedule: (fn) => void tasks.push(fn),
      ...extra
    })
  const run = () => {
    while (tasks.length) tasks.shift()!()
  }
  return { wc, reload, notify, log, watch, run, setNow: (n: number) => (t = n) }
}

describe('watchViewHealth (BG-020)', () => {
  it('reloads once after a renderer crash, only when the delayed reload runs', () => {
    const h = harness()
    h.watch()
    h.wc.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(h.reload).not.toHaveBeenCalled()
    h.run()
    expect(h.reload).toHaveBeenCalledOnce()
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('reloading'))
  })

  it('does nothing on a clean exit', () => {
    const h = harness()
    h.watch()
    h.wc.emit('render-process-gone', {}, { reason: 'clean-exit' })
    h.run()
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })

  it('shows a reload notice for an unresponsive view without reloading by itself', () => {
    const h = harness()
    h.watch()
    h.wc.emit('unresponsive')
    expect(h.notify).toHaveBeenCalledOnce()
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('unresponsive'))
  })

  it('caps automatic reloads per minute so a crash loop cannot spin', () => {
    const h = harness()
    h.watch({ maxReloads: 3 })
    for (let i = 0; i < 4; i++) h.wc.emit('render-process-gone', {}, { reason: 'crashed' })
    h.run()
    expect(h.reload).toHaveBeenCalledTimes(3)
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('reload limit reached'))
  })

  it('the disposer stops further reloads and removes both listeners', () => {
    const h = harness()
    const dispose = h.watch()
    dispose()
    expect(h.wc.count('render-process-gone')).toBe(0)
    expect(h.wc.count('unresponsive')).toBe(0)
    h.wc.emit('render-process-gone', {}, { reason: 'crashed' })
    h.wc.emit('unresponsive')
    h.run()
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
  })
})
