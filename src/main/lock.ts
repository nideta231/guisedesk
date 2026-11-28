// App lock (D9, D13-D17): state machine setup | locked | unlocked, scrypt hash, rate limit. No electron import.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './atomic'
import { validateNewSecret, type LockKind } from './lockrules'

export type LockState = 'setup' | 'locked' | 'unlocked'
export type UnlockResult = { result: 'ok' } | { result: 'wrong' } | { result: 'wait'; until: number }
export interface ScryptParams { N: number; r: number; p: number; keylen: number }
export interface LockRecord extends ScryptParams {
  v: 1
  kind: LockKind
  /** Digits in a PIN, so the pad can submit by itself; null for a password. */
  pinLength: number | null
  salt: string
  hash: string
  /** Wrong tries so far and the wait-until time, kept so a restart does not skip the wait. Absent = none. */
  fails?: number
  waitUntil?: number
}

export const DEFAULT_PARAMS: ScryptParams = { N: 32768, r: 8, p: 1, keylen: 64 }
export const MAX_TRIES = 5
export const WAIT_MS = 30_000
/** No valid PIN or password comes anywhere near this; a larger paste is refused before scrypt runs. */
export const MAX_ENTRY_BYTES = 1024

const derive = (secret: string, salt: Buffer, q: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(secret.normalize('NFKC'), salt, q.keylen, { N: q.N, r: q.r, p: q.p, maxmem: 256 * q.N * q.r }, (e, key) => (e ? reject(e) : resolve(key)))
  )

/** Hash with a fresh random 16-byte salt; the record keeps the params so they can change later. */
export async function hashSecret(secret: string, params: ScryptParams = DEFAULT_PARAMS, kind: LockKind = 'password'): Promise<LockRecord> {
  const salt = randomBytes(16)
  const key = await derive(secret, salt, params)
  return {
    v: 1,
    kind,
    pinLength: kind === 'pin' ? secret.length : null,
    salt: salt.toString('base64'),
    N: params.N,
    r: params.r,
    p: params.p,
    keylen: params.keylen,
    hash: key.toString('base64')
  }
}

const sane = (r: LockRecord) =>
  r && r.v === 1 && (r.kind === 'pin' || r.kind === 'password') && typeof r.salt === 'string' && typeof r.hash === 'string' &&
  Number.isInteger(r.N) && r.N >= 2 && r.N <= 1 << 20 && (r.N & (r.N - 1)) === 0 &&
  Number.isInteger(r.r) && r.r >= 1 && r.r <= 32 && Number.isInteger(r.p) && r.p >= 1 && r.p <= 16 &&
  Number.isInteger(r.keylen) && r.keylen >= 16 && r.keylen <= 128

/** Constant-time comparison of the derived key with the stored one. */
export async function verifySecret(secret: string, rec: LockRecord, deriveFn = derive): Promise<boolean> {
  if (!sane(rec) || typeof secret !== 'string') return false
  const want = Buffer.from(rec.hash, 'base64')
  const got = await deriveFn(secret, Buffer.from(rec.salt, 'base64'), rec)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** Ctrl+L, as Electron reports it in before-input-event. */
export const isLockShortcut = (i: { type: string; control?: boolean; alt?: boolean; meta?: boolean; key: string }): boolean =>
  i.type === 'keyDown' && !!i.control && !i.alt && !i.meta && i.key.toLowerCase() === 'l'

function readRecord(path: string): LockRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(path, 'utf8')) as LockRecord
    return sane(r) ? r : undefined
  } catch {
    return undefined
  }
}

export interface LockInfo { state: LockState; kind?: LockKind; pinLength?: number; waitUntil?: number }

export function createLock(opts: { dir: string; now?: () => number; params?: ScryptParams; startUnlocked?: boolean; derive?: typeof derive }) {
  const path = join(opts.dir, 'lock.json')
  const now = opts.now ?? Date.now
  const params = opts.params ?? DEFAULT_PARAMS
  const deriveFn = opts.derive ?? derive
  let rec = readRecord(path)
  // App start is always locked, or in setup when there is no (usable) lock.json.
  let state: LockState = opts.startUnlocked ? 'unlocked' : rec ? 'locked' : 'setup'
  // Wrong-try counter and wait live in lock.json too, so quitting and restarting does not skip the wait.
  let fails = rec && Number.isInteger(rec.fails) ? Math.min(Math.max(rec.fails!, 0), MAX_TRIES - 1) : 0
  // A wait further away than WAIT_MS is a clock change or a hand edit: cap it.
  let waitUntil = rec && Number.isFinite(rec.waitUntil) ? Math.min(rec.waitUntil!, now() + WAIT_MS) : 0
  let queue: Promise<unknown> = Promise.resolve()
  const listeners: ((s: LockState) => void)[] = []
  /** Atomic and private: temp file at 0600, then rename over lock.json. */
  const write = (next: LockRecord) => writeAtomic(path, JSON.stringify(next), undefined, 0o600)
  const persist = () => {
    if (!rec) return
    const { fails: _f, waitUntil: _w, ...base } = rec
    try {
      write(fails || waitUntil ? { ...base, fails, waitUntil } : base)
    } catch {
      /* the counter still holds in memory */
    }
  }
  const set = (s: LockState) => {
    if (s === state) return
    state = s
    for (const l of listeners) l(s)
  }

  return {
    state: (): LockState => state,
    info(): LockInfo {
      return {
        state,
        kind: rec?.kind,
        pinLength: rec?.pinLength ?? undefined,
        waitUntil: waitUntil > now() ? waitUntil : undefined
      }
    },
    onChange(cb: (s: LockState) => void): void {
      listeners.push(cb)
    },
    async setup(kind: LockKind, secret: string, repeat: string): Promise<{ ok: true } | { error: string }> {
      if (state !== 'setup') return { error: 'A lock is already set' }
      const v = validateNewSecret(kind, secret, repeat)
      if (!v.ok) return { error: v.error }
      const next = await hashSecret(secret, params, kind)
      write(next)
      rec = next
      fails = 0
      waitUntil = 0
      set('unlocked')
      return { ok: true }
    },
    /** The rate limit lives here: 5 wrong tries, then nothing is checked until the wait is over. */
    unlock(entry: string): Promise<UnlockResult> {
      // One attempt at a time, so parallel calls cannot all pass the wait check before the counter moves.
      const run = queue.then(() => attempt(entry))
      queue = run.catch(() => undefined)
      return run
    },
    lock(): void {
      if (state === 'unlocked' && rec) set('locked')
    },
    /**
     * Change PIN or password (Settings): needs the current entry, which goes through the same rate limit as unlock.
     * Then the new one is checked with the setup rules and the hash and kind are rewritten.
     */
    change(current: string, kind: LockKind, secret: string, repeat: string): Promise<{ ok: true } | { error: string; waitUntil?: number }> {
      const run = queue.then(() => replace(current, kind, secret, repeat))
      queue = run.catch(() => undefined)
      return run
    },
    /** After reset removed lock.json: forget the record and go back to setup. */
    reset(): void {
      rec = undefined
      fails = 0
      waitUntil = 0
      set('setup')
    }
  }

  async function attempt(entry: string): Promise<UnlockResult> {
    if (state === 'unlocked') return { result: 'ok' }
    if (state !== 'locked' || !rec) return { result: 'wrong' }
    const r = await check(entry)
    if (r.result === 'ok') set('unlocked')
    return r
  }

  async function replace(current: string, kind: LockKind, secret: string, repeat: string): Promise<{ ok: true } | { error: string; waitUntil?: number }> {
    if (state !== 'unlocked' || !rec) return { error: 'Not available while locked' }
    const r = await check(current)
    if (r.result === 'wait') return { error: 'Too many wrong tries. Wait a moment.', waitUntil: r.until }
    if (r.result === 'wrong') return { error: 'Wrong current entry' }
    const v = validateNewSecret(kind, secret, repeat)
    if (!v.ok) return { error: v.error }
    const next = await hashSecret(secret, params, kind)
    write(next)
    rec = next
    return { ok: true }
  }

  /** The rate-limited check of an entry against the stored hash; shared by unlock and change. */
  async function check(entry: string): Promise<UnlockResult> {
    if (!rec) return { result: 'wrong' }
    if (now() < waitUntil) return { result: 'wait', until: waitUntil }
    const text = String(entry ?? '')
    // A pasted megabyte would make scrypt allocate and hash it all; count it as a normal wrong try instead.
    const tooLong = Buffer.byteLength(text, 'utf8') > MAX_ENTRY_BYTES
    if (!tooLong && (await verifySecret(text, rec, deriveFn))) {
      if (fails || waitUntil) {
        fails = 0
        waitUntil = 0
        persist()
      }
      return { result: 'ok' }
    }
    if (++fails >= MAX_TRIES) {
      fails = 0
      waitUntil = now() + WAIT_MS
      persist()
      return { result: 'wait', until: waitUntil }
    }
    persist()
    return { result: 'wrong' }
  }
}

export type Lock = ReturnType<typeof createLock>
