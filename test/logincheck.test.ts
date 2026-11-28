import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectLogins, createLoginScheduler } from '../src/main/logincheck'

describe('login check scheduler (PF-003)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('five schedules inside the coalesce window produce one run', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const scheduler = createLoginScheduler(run)
    for (let i = 0; i < 5; i++) scheduler.schedule(2500)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2499)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledOnce()
  })

  it('a reload while a run is pending does not queue a second check', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const scheduler = createLoginScheduler(run, { coalesceMs: 30_000 })
    scheduler.schedule(2500)
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.schedule(2500)
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledOnce()
  })

  it('a check after a long gap still runs', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const scheduler = createLoginScheduler(run)
    scheduler.schedule(2500)
    await vi.advanceTimersByTimeAsync(2500)
    expect(run).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_001)
    scheduler.schedule(2500)
    await vi.advanceTimersByTimeAsync(2500)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('concurrent login states (PF-004)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('two WhatsApp accounts each taking 1.5 s finish together in under 2 s, both recorded', async () => {
    vi.useFakeTimers()
    let settled: Record<string, boolean> | undefined
    const p = collectLogins(
      [
        { id: 'a', serviceId: 'whatsapp' },
        { id: 'b', serviceId: 'whatsapp' }
      ],
      {
        whatsapp: async (a) => {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          return a.id === 'a'
        },
        cookie: async () => undefined
      }
    )
    void p.then((states) => {
      settled = states
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(settled).toEqual({ a: true, b: false })
    expect(await p).toEqual({ a: true, b: false })
  })

  it('caps WhatsApp page checks at three at a time', async () => {
    vi.useFakeTimers()
    let running = 0
    let peak = 0
    const accounts = Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, serviceId: 'whatsapp' }))
    const p = collectLogins(accounts, {
      whatsapp: async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 100))
        running--
        return true
      },
      cookie: async () => undefined
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(await p).toEqual(Object.fromEntries(accounts.map((a) => [a.id, true])))
    expect(peak).toBe(3)
  })

  it('cookie services are checked alongside WhatsApp and undefined states are skipped', async () => {
    vi.useFakeTimers()
    const p = collectLogins(
      [
        { id: 'wa', serviceId: 'whatsapp' },
        { id: 'ig', serviceId: 'instagram' },
        { id: 'none', serviceId: 'mastodon' }
      ],
      {
        whatsapp: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return true
        },
        cookie: async (a) => (a.id === 'ig' ? false : undefined)
      }
    )
    await vi.advanceTimersByTimeAsync(50)
    expect(await p).toEqual({ wa: true, ig: false })
  })
})
