import * as nodeFs from 'node:fs'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomic, type Fs } from '../src/main/atomic'

describe('writeAtomic mode', () => {
  it('applies the mode even when a looser temp file is left over', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-atomic-'))
    const f = join(dir, 'x.json')
    writeFileSync(`${f}.tmp`, 'old', { mode: 0o644 })
    writeAtomic(f, 'new', undefined, 0o600)
    expect(readFileSync(f, 'utf8')).toBe('new')
    expect(statSync(f).mode & 0o777).toBe(0o600)
  })
})

describe('writeAtomic temp file', () => {
  it('gives every writer its own temp file and never reuses <path>.tmp', () => {
    const temps: string[] = []
    const fake = (): Fs => ({
      writeFileSync: (p: string) => void temps.push(p),
      chmodSync: () => undefined,
      renameSync: (from: string) => void temps.push(`renamed ${from}`),
      unlinkSync: () => undefined
    })
    writeAtomic('/data/a.json', 'one', fake())
    writeAtomic('/data/a.json', 'two', fake())
    const created = temps.filter((x) => !x.startsWith('renamed '))
    expect(created).toHaveLength(2)
    expect(new Set(created).size).toBe(2)
    expect(created).not.toContain('/data/a.json.tmp')
    for (const x of created) expect(temps).toContain(`renamed ${x}`)
  })

  it('does not touch an existing <path>.tmp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-atomic-'))
    const f = join(dir, 'x.json')
    writeFileSync(`${f}.tmp`, 'planted')
    writeAtomic(f, 'new')
    expect(readFileSync(`${f}.tmp`, 'utf8')).toBe('planted')
    expect(readFileSync(f, 'utf8')).toBe('new')
  })

  it('removes its temp file when the write throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-atomic-'))
    const f = join(dir, 'x.json')
    const fake: Fs = {
      ...nodeFs,
      writeFileSync: (p: string, d: string | Uint8Array, o?: { mode?: number; flag?: string }) => {
        nodeFs.writeFileSync(p, d, o)
        throw new Error('disk full')
      }
    }
    expect(() => writeAtomic(f, 'new', fake)).toThrow('disk full')
    expect(readdirSync(dir)).toEqual([])
  })

  it('removes its temp file when the rename throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-atomic-'))
    const f = join(dir, 'x.json')
    const fake: Fs = {
      ...nodeFs,
      renameSync: () => {
        throw new Error('rename failed')
      }
    }
    expect(() => writeAtomic(f, 'new', fake)).toThrow('rename failed')
    expect(readdirSync(dir)).toEqual([])
  })
})
