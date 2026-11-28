import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoginScheduler } from '../src/main/logincheck'

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
