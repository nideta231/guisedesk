import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resetData, wipeFiles } from '../src/main/reset'
import { runReset } from '../src/main/resetflow'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gd-reset-'))
  const dir = join(root, 'data')
  const outside = join(root, 'keep.txt')
  mkdirSync(join(dir, 'Partitions', 'acc1'), { recursive: true })
  mkdirSync(join(dir, 'Partitions', 'acc2'), { recursive: true })
  mkdirSync(join(dir, 'icons'), { recursive: true })
  writeFileSync(join(dir, 'Partitions', 'acc1', 'Cookies'), 'x')
  writeFileSync(join(dir, 'icons', 'example.com.png'), 'x')
  writeFileSync(join(dir, 'accounts.json'), '[]')
  writeFileSync(join(dir, 'lock.json'), '{}')
  writeFileSync(join(dir, 'settings.json'), '{"idleLock":5}')
  writeFileSync(outside, 'mine')
  return { root, dir, outside }
}

describe('reset', () => {
  it('does nothing unless RESET is typed exactly', () => {
    const { dir } = fixture()
    for (const typed of ['', 'reset', 'RESET ', 'Reset', undefined, 5]) {
      expect(resetData(dir, typed as string)).toHaveProperty('error')
    }
    expect(existsSync(join(dir, 'accounts.json'))).toBe(true)
    expect(existsSync(join(dir, 'lock.json'))).toBe(true)
    expect(existsSync(join(dir, 'Partitions', 'acc1'))).toBe(true)
  })

  it('removes accounts.json, lock.json, cached icons and partition dirs; keeps settings.json and anything outside', () => {
    const { dir, outside } = fixture()
    expect(resetData(dir, 'RESET')).toEqual({ ok: true })
    expect(existsSync(join(dir, 'accounts.json'))).toBe(false)
    expect(existsSync(join(dir, 'lock.json'))).toBe(false)
    expect(existsSync(join(dir, 'icons'))).toBe(false)
    expect(existsSync(join(dir, 'Partitions'))).toBe(false)
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"idleLock":5}')
    expect(readFileSync(outside, 'utf8')).toBe('mine')
  })

  it('forgets saved proxy passwords, split and the selected account but keeps DND and other prefs', () => {
    const { dir } = fixture()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      idleLock: 5,
      dnd: true,
      quietWorkHours: true,
      proxyAuth: { ig1: { username: 'u', password: 'p' } },
      split: { b: 'ig2', ratio: 0.5 },
      selectedAccount: 'ig1'
    }))
    expect(resetData(dir, 'RESET')).toEqual({ ok: true })
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(settings.proxyAuth).toBeUndefined()
    expect(settings.split).toBeUndefined()
    expect(settings.selectedAccount).toBeUndefined()
    expect(settings).toMatchObject({ idleLock: 5, dnd: true, quietWorkHours: true })
  })

  it('works on a data dir that has none of those yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-reset-empty-'))
    expect(resetData(dir, 'RESET')).toEqual({ ok: true })
  })

  it('closes popups first, then clears storage, then wipes, even when no views are open', async () => {
    const order: string[] = []
    const r = await runReset({
      closePopups: () => void order.push('closePopups'),
      clearStorage: async () => void order.push('clearStorage'),
      wipe: () => {
        order.push('wipe')
        return { ok: true }
      }
    })
    expect(order).toEqual(['closePopups', 'clearStorage', 'wipe'])
    expect(r).toEqual({ ok: true })
  })

  it('stops before wiping when the confirmation is wrong', async () => {
    const order: string[] = []
    const r = await runReset({
      closePopups: () => void order.push('closePopups'),
      clearStorage: () => void order.push('clearStorage'),
      wipe: () => ({ error: 'Type RESET to confirm' })
    })
    expect(order).toEqual(['closePopups', 'clearStorage'])
    expect(r).toHaveProperty('error')
  })

  it('refuses to remove any path outside the data dir', () => {
    const { dir, outside } = fixture()
    expect(() => wipeFiles(dir, [join(dir, '..', 'keep.txt')])).toThrow(/outside/)
    expect(() => wipeFiles(dir, [dir])).toThrow(/outside/)
    expect(() => wipeFiles('relative/dir', [])).toThrow()
    expect(readFileSync(outside, 'utf8')).toBe('mine')
  })
})
