import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { doneNotice, downloadOutcome, loadDownloads, pickFolder, saveDownloads, uniquePath } from '../src/main/downloads'

describe('downloads settings', () => {
  it('defaults to ask off and no folder; round-trip keeps other settings.json keys', () => {
    const d = mkdtempSync(join(tmpdir(), 'gd-dl-'))
    expect(loadDownloads(d)).toEqual({ ask: false })
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ dnd: true, selectedAccount: 'a' }))
    saveDownloads(d, { dir: '/home/x/Files', ask: true })
    expect(loadDownloads(d)).toEqual({ dir: '/home/x/Files', ask: true })
    const all = JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'))
    expect(all).toMatchObject({ dnd: true, selectedAccount: 'a', downloads: { dir: '/home/x/Files', ask: true } })
  })
})

describe('uniquePath', () => {
  it('picks the first free name', () => {
    const taken = new Set(['/d/a.png', '/d/a (1).png'])
    expect(uniquePath('/d', 'a.png', (p) => taken.has(p))).toBe('/d/a (2).png')
    expect(uniquePath('/d', 'b.png', (p) => taken.has(p))).toBe('/d/b.png')
    expect(uniquePath('/d', 'notes', (p) => p === '/d/notes')).toBe('/d/notes (1)')
  })

  it('sanitises slashes, leading dots and empty names', () => {
    const none = () => false
    expect(uniquePath('/d', '../../etc/passwd', none)).toBe('/d/passwd')
    expect(uniquePath('/d', '..\\evil.txt', none)).toBe('/d/evil.txt')
    expect(uniquePath('/d', '.bashrc', none)).toBe('/d/bashrc')
    expect(uniquePath('/d', '', none)).toBe('/d/download')
    expect(uniquePath('/d', '...', none)).toBe('/d/download')
  })
})

describe('pickFolder', () => {
  it('uses the saved folder while it exists and falls back to the system Downloads folder', () => {
    expect(pickFolder('/gone', '/home/x/Downloads', (p) => p === '/home/x/Downloads')).toBe('/home/x/Downloads')
    expect(pickFolder('/media/usb/Downloads', '/home/x/Downloads', (p) => p === '/media/usb/Downloads')).toBe('/media/usb/Downloads')
    expect(pickFolder(undefined, '/home/x/Downloads', () => true)).toBe('/home/x/Downloads')
    expect(pickFolder('', '/home/x/Downloads', () => true)).toBe('/home/x/Downloads')
  })
})

describe('downloadOutcome', () => {
  it('keeps a user cancel silent, reports a completed download as ok and an interruption as failed', () => {
    expect(downloadOutcome('cancelled')).toBe('silent')
    expect(downloadOutcome('completed')).toBe('ok')
    expect(downloadOutcome('interrupted')).toBe('failed')
  })
})

describe('doneNotice', () => {
  it('names the file when ok, is generic when locked, and says failed on failure', () => {
    expect(doneNotice({ ok: true, file: 'a.png', locked: false }).title).toBe('Downloaded a.png')
    expect(doneNotice({ ok: true, file: 'a.png', locked: true })).toEqual({ title: 'Download finished', body: '' })
    expect(doneNotice({ ok: false, file: 'a.png', locked: false }).title).toBe('Download failed')
    expect(JSON.stringify(doneNotice({ ok: false, file: 'secret.pdf', locked: true }))).not.toContain('secret')
  })
})
