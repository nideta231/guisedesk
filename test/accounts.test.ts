import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import * as realFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addAccount, loadAccounts, loadDnd, loadSelected, loadSidebarCollapsed, orderedAccounts, saveAccounts, saveDnd, saveSelected, reorderAccounts, saveSidebarCollapsed, setMuted, setZoom } from '../src/main/accounts'
import { PRESETS } from '../src/main/presets'

const tmp = () => mkdtempSync(join(tmpdir(), 'gd-acc-'))

describe('accounts store', () => {
  it('round-trips accounts with generated unique ids', () => {
    const dir = tmp()
    const a = addAccount(dir, { serviceId: 'whatsapp', label: 'Personal', colour: '#6d5bd0' })
    const b = addAccount(dir, { serviceId: 'whatsapp', label: 'Business', colour: '#c7772a' })
    expect(a.id).not.toBe(b.id)
    const loaded = loadAccounts(dir)
    expect(loaded.map((x) => x.label)).toEqual(['Personal', 'Business'])
    expect(loaded[0]).toEqual(a)
  })

  it('loads an empty list when no file exists', () => {
    expect(loadAccounts(tmp())).toEqual([])
  })

  it('keeps the old file intact when the write dies before the rename', () => {
    const dir = tmp()
    const a = addAccount(dir, { serviceId: 'discord', label: 'ben_n', colour: '#4a5bc4' })
    const crashing = {
      ...realFs,
      renameSync: () => {
        throw new Error('crash mid-write')
      }
    }
    expect(() => saveAccounts(dir, [], crashing)).toThrow('crash mid-write')
    expect(loadAccounts(dir)).toEqual([a])
    expect(JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'))).toHaveLength(1)
  })

  it('drops bad rows, keeps unknown keys and gives a missing order the array index', () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'accounts.json'),
      JSON.stringify([null, {}, 'nope', { id: 'ok', serviceId: 'whatsapp', label: 'OK', colour: '#000', future: 7 }])
    )
    const loaded = loadAccounts(dir)
    expect(loaded).toEqual([{ id: 'ok', serviceId: 'whatsapp', label: 'OK', colour: '#000', order: 3, future: 7 }])
    saveAccounts(dir, loaded)
    expect(loadAccounts(dir)).toEqual(loaded)
  })

  it('drops rows with an unsafe id or an unknown shareWith, keeps valid shared rows', () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'accounts.json'),
      JSON.stringify([
        { id: '../x', serviceId: 'instagram', label: 'Bad', colour: '#000', order: 0 },
        { id: 'a', serviceId: 'instagram', label: 'A', colour: '#000', order: 1 },
        { id: 'b', serviceId: 'threads', label: 'B', colour: '#000', order: 2, shareWith: '../x' },
        { id: 'c', serviceId: 'threads', label: 'C', colour: '#000', order: 3, shareWith: 'missing' },
        { id: 'd', serviceId: 'threads', label: 'D', colour: '#000', order: 4, shareWith: 'a' },
        { id: 'e_1', serviceId: 'threads', label: 'E', colour: '#000', order: 5, shareWith: 'a' }
      ])
    )
    expect(loadAccounts(dir).map((x) => x.id)).toEqual(['a', 'd', 'e_1'])
  })

  it('drops a duplicate id and keeps the first row', () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'accounts.json'),
      JSON.stringify([
        { id: 'a', serviceId: 'whatsapp', label: 'First', colour: '#000', order: 0 },
        { id: 'a', serviceId: 'whatsapp', label: 'Second', colour: '#000', order: 1 }
      ])
    )
    expect(loadAccounts(dir).map((x) => x.label)).toEqual(['First'])
  })

  it('returns accounts sorted by stored order', () => {
    const dir = tmp()
    writeFileSync(
      join(dir, 'accounts.json'),
      JSON.stringify([
        { id: 'b', serviceId: 'x', label: 'B', colour: '#000', order: 1 },
        { id: 'a', serviceId: 'x', label: 'A', colour: '#000', order: 0 }
      ])
    )
    expect(orderedAccounts(loadAccounts(dir)).map((x) => x.id)).toEqual(['a', 'b'])
    expect(existsSync(join(dir, 'accounts.json.tmp'))).toBe(false)
  })

  it('has the seven presets with kinds', () => {
    expect(PRESETS.filter((p) => p.kind === 'chat').map((p) => p.id)).toEqual(['whatsapp', 'discord'])
    expect(PRESETS.filter((p) => p.kind === 'feed').map((p) => p.id)).toEqual([
      'instagram', 'facebook', 'x', 'threads', 'tiktok'
    ])
  })

  it('requires a label, trims it, and allows a duplicate label within a service', () => {
    const dir = tmp()
    expect(() => addAccount(dir, { serviceId: 'whatsapp', label: '   ', colour: '#6d5bd0' })).toThrow('Label is required')
    expect(loadAccounts(dir)).toEqual([])
    const a = addAccount(dir, { serviceId: 'whatsapp', label: '  Business  ', colour: '#6d5bd0' })
    const b = addAccount(dir, { serviceId: 'whatsapp', label: 'Business', colour: '#c7772a' })
    expect(a.label).toBe('Business')
    expect(b.label).toBe('Business')
    expect(loadAccounts(dir)).toHaveLength(2)
  })

  it('accepts only http(s) URLs for a custom site', () => {
    const dir = tmp()
    const custom = (url: string) => ({ serviceId: 'custom', label: 'Wiki', colour: '#6d5bd0', custom: { name: 'Wiki', url } })
    for (const bad of ['', 'example.com', 'ftp://example.com/', 'javascript:alert(1)', 'file:///etc/passwd'])
      expect(() => addAccount(dir, custom(bad))).toThrow('URL must start with http:// or https://')
    expect(() => addAccount(dir, { ...custom('https://example.com'), custom: { name: ' ', url: 'https://example.com' } })).toThrow('Name is required')
    expect(() => addAccount(dir, { serviceId: 'nope', label: 'x', colour: '#000000' })).toThrow('Unknown service')
    expect(loadAccounts(dir)).toEqual([])
    expect(addAccount(dir, custom('http://wiki.example.com/start')).serviceId).toBe('custom')
  })

  it('stores a custom account host as its same-service host list', () => {
    const a = addAccount(tmp(), {
      serviceId: 'custom', label: 'Wiki', colour: '#6d5bd0', custom: { name: ' Team Wiki ', url: 'https://Wiki.Example.com:8080/start' }
    })
    expect(a.custom).toEqual({ name: 'Team Wiki', url: 'https://Wiki.Example.com:8080/start', hosts: ['wiki.example.com'] })
  })
})

describe('mute and Do Not Disturb persistence', () => {
  it('setMuted stores the flag per account and survives a reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-mute-'))
    const a = addAccount(dir, { serviceId: 'discord', label: 'ben_n', colour: '#6d5bd0' })
    const b = addAccount(dir, { serviceId: 'whatsapp', label: 'Personal', colour: '#6d5bd0' })
    setMuted(dir, a.id, true)
    const again = loadAccounts(dir)
    expect(again.find((x) => x.id === a.id)?.muted).toBe(true)
    expect(again.find((x) => x.id === b.id)?.muted).toBe(false)
    setMuted(dir, a.id, false)
    expect(loadAccounts(dir).find((x) => x.id === a.id)?.muted).toBe(false)
  })
  it('the collapsed sidebar is saved in settings and restored, next to the other settings', () => {
    const dir = tmp()
    expect(loadSidebarCollapsed(dir)).toBe(false)
    saveDnd(dir, true)
    saveSidebarCollapsed(dir, true)
    expect(loadSidebarCollapsed(dir)).toBe(true)
    expect(loadDnd(dir)).toBe(true)
    saveSidebarCollapsed(dir, false)
    expect(loadSidebarCollapsed(dir)).toBe(false)
    expect(loadDnd(dir)).toBe(true)
  })
  it('Do Not Disturb is off by default, is stored in settings and keeps the selected account', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-dnd-'))
    expect(loadDnd(dir)).toBe(false)
    saveSelected(dir, 'x1')
    saveDnd(dir, true)
    expect(loadDnd(dir)).toBe(true)
    expect(loadSelected(dir)).toBe('x1')
    saveSelected(dir, 'x2')
    expect(loadDnd(dir)).toBe(true)
    saveDnd(dir, false)
    expect(loadDnd(dir)).toBe(false)
  })
  it('reorderAccounts saves the new order and it reads back sorted', () => {
    const dir = tmp()
    const mk = (id: string, order: number) => ({ id, serviceId: 'whatsapp', label: id, colour: '#000', order })
    saveAccounts(dir, [mk('a', 0), mk('b', 1), mk('c', 2)])
    const out = reorderAccounts(dir, ['c', 'a', 'b'])
    expect(orderedAccounts(loadAccounts(dir)).map((a) => [a.id, a.order])).toEqual([['c', 0], ['a', 1], ['b', 2]])
    expect(orderedAccounts(out).map((a) => a.id)).toEqual(['c', 'a', 'b'])
  })
  it('reorderAccounts rejects unknown and duplicate ids and keeps unlisted accounts in their order after the listed ones', () => {
    const dir = tmp()
    const mk = (id: string, order: number) => ({ id, serviceId: 'whatsapp', label: id, colour: '#000', order })
    saveAccounts(dir, [mk('a', 0), mk('b', 1), mk('c', 2), mk('d', 3)])
    expect(() => reorderAccounts(dir, ['a', 'zzz'])).toThrow()
    expect(() => reorderAccounts(dir, ['a', 'a'])).toThrow()
    expect(orderedAccounts(loadAccounts(dir)).map((a) => a.id)).toEqual(['a', 'b', 'c', 'd'])
    reorderAccounts(dir, ['d', 'b'])
    expect(orderedAccounts(loadAccounts(dir)).map((a) => [a.id, a.order])).toEqual([['d', 0], ['b', 1], ['a', 2], ['c', 3]])
  })
})

describe('setZoom', () => {
  it('persists the level on one account and 0 removes the key', () => {
    const dir = tmp()
    const mk = (id: string, order: number) => ({ id, serviceId: 'whatsapp', label: id, colour: '#000', order })
    saveAccounts(dir, [mk('a', 0), mk('b', 1)])
    const out = setZoom(dir, 'a', 1.5)
    expect(out.find((x) => x.id === 'a')!.zoom).toBe(1.5)
    expect(loadAccounts(dir).map((x) => x.zoom)).toEqual([1.5, undefined])
    setZoom(dir, 'a', 0)
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).not.toContain('zoom')
  })
})
