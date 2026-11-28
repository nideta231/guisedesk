import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createGuardedIpc } from '../src/main/guard'
import { createLock, hashSecret, isLockShortcut, verifySecret } from '../src/main/lock'
import { validateNewSecret } from '../src/main/lockrules'

// Cheap scrypt cost for the state-machine tests; the hash tests use the real default params.
const FAST = { N: 1024, r: 8, p: 1, keylen: 32 }
const tmp = () => mkdtempSync(join(tmpdir(), 'gd-lock-'))

async function fresh(opts: { now?: () => number; dir?: string } = {}) {
  const dir = opts.dir ?? tmp()
  const clock = { t: 1_000_000 }
  const lock = createLock({ dir, now: opts.now ?? (() => clock.t), params: FAST })
  return { dir, clock, lock }
}

describe('hash', () => {
  it('never equals the secret, uses a random salt, stores its params, verifies right and wrong', async () => {
    const a = await hashSecret('123456')
    const b = await hashSecret('123456')
    expect(a.hash).not.toContain('123456')
    expect(a.hash).not.toBe(Buffer.from('123456').toString('base64'))
    expect(Buffer.from(a.salt, 'base64').length).toBeGreaterThanOrEqual(16)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    expect(a).toMatchObject({ N: 32768, r: 8, p: 1, keylen: 64 })
    expect(await verifySecret('123456', a)).toBe(true)
    expect(await verifySecret('123457', a)).toBe(false)
    expect(await verifySecret('', a)).toBe(false)
  })

  it('verifies with the params stored in the record, not the current defaults', async () => {
    const rec = await hashSecret('654321', FAST)
    expect(rec).toMatchObject(FAST)
    expect(await verifySecret('654321', rec)).toBe(true)
  })
})

describe('setup rules', () => {
  it('rejects a 3-digit PIN, non-digits, a mismatched repeat; accepts 4 digits and an 8-char password', () => {
    expect(validateNewSecret('pin', '123', '123')).toMatchObject({ ok: false })
    expect(validateNewSecret('pin', '1234', '1234')).toEqual({ ok: true })
    expect(validateNewSecret('pin', '12345a', '12345a')).toMatchObject({ ok: false })
    expect(validateNewSecret('pin', '123456', '123457')).toEqual({ ok: false, error: 'The two entries do not match' })
    expect(validateNewSecret('pin', '123456', '123456')).toEqual({ ok: true })
    expect(validateNewSecret('password', 'short', 'short')).toMatchObject({ ok: false })
    expect(validateNewSecret('password', 'longenough', 'longenough')).toEqual({ ok: true })
  })

  it('lock.setup refuses a 5-digit PIN and a mismatch and writes nothing', async () => {
    const { lock, dir } = await fresh()
    expect(lock.state()).toBe('setup')
    expect(await lock.setup('pin', '123', '123')).toHaveProperty('error')
    expect(await lock.setup('pin', '123456', '654321')).toHaveProperty('error')
    expect(lock.state()).toBe('setup')
    expect(() => readFileSync(join(dir, 'lock.json'))).toThrow()
  })
})

describe('lock state machine', () => {
  it('setup writes lock.json with mode 0600, holds no PIN, and leaves the app unlocked', async () => {
    const { lock, dir } = await fresh()
    expect(await lock.setup('pin', '123456', '123456')).toEqual({ ok: true })
    expect(lock.state()).toBe('unlocked')
    const path = join(dir, 'lock.json')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain('123456')
    expect(JSON.parse(text)).toMatchObject({ kind: 'pin', N: 1024, r: 8, p: 1, keylen: 32 })
  })

  it('a new app start with lock.json begins locked; Lock then right PIN unlocks, wrong does not', async () => {
    const first = await fresh()
    await first.lock.setup('pin', '123456', '123456')
    const { lock } = await fresh({ dir: first.dir })
    expect(lock.state()).toBe('locked')
    expect(lock.info()).toMatchObject({ state: 'locked', kind: 'pin', pinLength: 6 })
    expect(await lock.unlock('000000')).toEqual({ result: 'wrong' })
    expect(lock.state()).toBe('locked')
    expect(await lock.unlock('123456')).toEqual({ result: 'ok' })
    expect(lock.state()).toBe('unlocked')
    lock.lock()
    expect(lock.state()).toBe('locked')
  })

  it('lock() does nothing in setup, and notifies listeners on a change', async () => {
    const { lock } = await fresh()
    lock.lock()
    expect(lock.state()).toBe('setup')
    const seen: string[] = []
    lock.onChange((s) => seen.push(s))
    await lock.setup('password', 'longenough', 'longenough')
    lock.lock()
    expect(seen).toEqual(['unlocked', 'locked'])
  })

  it('5 wrong tries start a 30 s wait (fake clock); a right PIN during the wait is refused, after it works', async () => {
    const { lock, clock } = await fresh()
    await lock.setup('pin', '123456', '123456')
    lock.lock()
    for (let i = 0; i < 4; i++) expect(await lock.unlock('111111')).toEqual({ result: 'wrong' })
    expect(await lock.unlock('111111')).toEqual({ result: 'wait', until: clock.t + 30_000 })
    expect(await lock.unlock('123456')).toEqual({ result: 'wait', until: clock.t + 30_000 })
    expect(lock.info().waitUntil).toBe(clock.t + 30_000)
    clock.t += 29_999
    expect(await lock.unlock('123456')).toMatchObject({ result: 'wait' })
    clock.t += 1
    expect(await lock.unlock('123456')).toEqual({ result: 'ok' })
  })

  it('after a wait the counter restarts: 4 more wrong tries are plain wrong', async () => {
    const { lock, clock } = await fresh()
    await lock.setup('pin', '123456', '123456')
    lock.lock()
    for (let i = 0; i < 5; i++) await lock.unlock('111111')
    clock.t += 30_000
    for (let i = 0; i < 4; i++) expect(await lock.unlock('111111')).toEqual({ result: 'wrong' })
  })
})

describe('oversized entry (SE-008)', () => {
  it('a megabyte paste is a wrong try without deriving, and counts toward the wait', async () => {
    const first = await fresh()
    await first.lock.setup('pin', '123456', '123456')
    const derive = vi.fn(async () => Buffer.alloc(FAST.keylen))
    const { lock, clock } = await fresh({ dir: first.dir })
    const guarded = createLock({ dir: first.dir, params: FAST, derive, now: () => clock.t })
    expect(guarded.state()).toBe('locked')
    expect(await guarded.unlock('x'.repeat(1_000_000))).toEqual({ result: 'wrong' })
    expect(derive).not.toHaveBeenCalled()
    // The oversized try already counted: four more wrong entries reach the limit that would need five from zero.
    for (let i = 0; i < 3; i++) expect(await guarded.unlock('111111')).toEqual({ result: 'wrong' })
    expect(await guarded.unlock('111111')).toEqual({ result: 'wait', until: clock.t + 30_000 })
    expect(derive).toHaveBeenCalledTimes(4)
    expect(lock.state()).toBe('locked')
  })
})

describe('rate limit under parallel attempts', () => {
  it('20 parallel wrong tries cannot all be checked: at most 5 reach the check', async () => {
    const { lock, clock } = await fresh()
    await lock.setup('pin', '123456', '123456')
    lock.lock()
    const rs = await Promise.all(Array.from({ length: 20 }, () => lock.unlock('111111')))
    expect(rs.filter((r) => r.result === 'wrong')).toHaveLength(4)
    expect(rs.filter((r) => r.result === 'wait')).toHaveLength(16)
    expect(await lock.unlock('123456')).toEqual({ result: 'wait', until: clock.t + 30_000 })
  })
})

describe('Ctrl+L shortcut', () => {
  it('matches Ctrl+L key down only', () => {
    expect(isLockShortcut({ type: 'keyDown', control: true, key: 'l' })).toBe(true)
    expect(isLockShortcut({ type: 'keyDown', control: true, key: 'L' })).toBe(true)
    expect(isLockShortcut({ type: 'keyUp', control: true, key: 'l' })).toBe(false)
    expect(isLockShortcut({ type: 'keyDown', control: false, key: 'l' })).toBe(false)
    expect(isLockShortcut({ type: 'keyDown', control: true, alt: true, key: 'l' })).toBe(false)
    expect(isLockShortcut({ type: 'keyDown', control: true, key: 'k' })).toBe(false)
  })
})

describe('IPC guard', () => {
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

  it('account-data handlers refuse while locked or in setup and answer once unlocked', async () => {
    const { lock } = await fresh()
    const { ipc, handlers, listeners } = fakeIpc()
    const g = createGuardedIpc(ipc, () => lock.state() === 'unlocked')
    let called = 0
    g.handle('accounts:state', () => (called++, { accounts: [{ label: 'Secret shop' }] }))
    let selected = 0
    g.on('accounts:select', () => void selected++)
    // setup state
    expect(() => handlers.get('accounts:state')!({})).toThrow('locked')
    listeners.get('accounts:select')!({}, 'a1')
    await lock.setup('pin', '123456', '123456')
    expect(handlers.get('accounts:state')!({})).toEqual({ accounts: [{ label: 'Secret shop' }] })
    listeners.get('accounts:select')!({}, 'a1')
    expect(selected).toBe(1)
    lock.lock()
    expect(() => handlers.get('accounts:state')!({})).toThrow('locked')
    listeners.get('accounts:select')!({}, 'a1')
    expect(called).toBe(1)
    expect(selected).toBe(1)
  })
})
