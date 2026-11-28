import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadTrayHintShown, saveTrayHintShown } from '../src/main/accounts'
import { maybeShowTrayHint, shouldShowTrayHint } from '../src/main/trayhint'

describe('first close tray hint (UX-032)', () => {
  it('is due only before the saved flag', () => {
    expect(shouldShowTrayHint(false)).toBe(true)
    expect(shouldShowTrayHint(true)).toBe(false)
  })

  it('a fake close path shows one notification and saves the flag, a second close shows none', () => {
    let shown = false
    const notify = vi.fn()
    const save = vi.fn(() => {
      shown = true
    })
    const io = { shown: () => shown, save, notify }
    expect(maybeShowTrayHint(io)).toBe(true)
    expect(notify).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
    expect(maybeShowTrayHint(io)).toBe(false)
    expect(notify).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })

  it('an old settings.json without the key means the hint is still due, and the flag round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-trayhint-'))
    try {
      expect(loadTrayHintShown(dir)).toBe(false)
      saveTrayHintShown(dir, true)
      expect(loadTrayHintShown(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
