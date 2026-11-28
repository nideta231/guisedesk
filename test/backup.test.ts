// @vitest-environment jsdom
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allowedRestorePath, applyPendingRestore, buildBackupArchive, decryptBackup, encryptBackup, inspectBackupBytes, PENDING_ARCHIVE, PENDING_MARKER, packArchive, prepareRestore, readArchiveManifest, unpackArchive } from '../src/main/backup'
import { backupDate, backupFileName, passwordProblem } from '../src/main/backuprules'
import BackupDialog from '../src/renderer/src/BackupDialog.vue'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'

const PARAMS = { N: 1024, r: 8, p: 1 }
const EXT_ID = 'a'.repeat(32)
const PW = 'longenough'

const manifest: BackupManifest = {
  app: 'guisedesk',
  format: 1,
  created: '2026-11-27T12:00:00.000Z',
  version: '0.1.19',
  includeLogins: true,
  accounts: 2,
  settings: true,
  lock: true,
  extensions: [EXT_ID],
  files: 5,
  bytes: 1234
}

function seed(dir: string) {
  writeFileSync(join(dir, 'accounts.json'), JSON.stringify([
    { id: 'w1', serviceId: 'whatsapp', label: 'Personal', colour: '#25d366', order: 0 },
    { id: 't1', serviceId: 'threads', label: 'Personal', colour: '#6d5bd0', order: 1 }
  ]))
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ selectedAccount: 'w1' }))
  writeFileSync(join(dir, 'lock.json'), JSON.stringify({ v: 1, kind: 'pin' }))
  const level = join(dir, 'Partitions', 'w1', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb')
  mkdirSync(level, { recursive: true })
  writeFileSync(join(level, '000003.log'), 'wa-indexeddb')
  const local = join(dir, 'Partitions', 'w1', 'Local Storage', 'leveldb')
  mkdirSync(local, { recursive: true })
  writeFileSync(join(local, '000003.log'), 'local-storage')
  const ext = join(dir, 'extensions', EXT_ID, '1.2.3_0')
  mkdirSync(ext, { recursive: true })
  writeFileSync(join(ext, 'manifest.json'), JSON.stringify({ name: 'Test extension', version: '1.2.3', manifest_version: 3 }))
}

describe('backup format (D61)', () => {
  it('packs and unpacks entries in path order; rejects a bad or truncated archive', () => {
    const packed = packArchive([{ path: 'b.txt', data: Buffer.from('b') }, { path: 'a/c.txt', data: Buffer.from('c') }])
    expect(packed.subarray(0, 6).toString()).toBe('GDTAR1')
    expect(unpackArchive(packed).map((e) => [e.path, e.data.toString()])).toEqual([['a/c.txt', 'c'], ['b.txt', 'b']])
    expect(unpackArchive(packArchive([]))).toEqual([])
    expect(() => unpackArchive(Buffer.from('nope'))).toThrow(/not valid/)
    expect(() => unpackArchive(packed.subarray(0, packed.length - 1))).toThrow(/truncated/)
  })

  it('allows only the metadata files and Partitions paths', () => {
    expect(allowedRestorePath('accounts.json')).toBe(true)
    expect(allowedRestorePath('settings.json')).toBe(true)
    expect(allowedRestorePath('lock.json')).toBe(true)
    expect(allowedRestorePath('Partitions/w1/Cookies')).toBe(true)
    expect(allowedRestorePath('manifest.json')).toBe(false)
    expect(allowedRestorePath('extensions/x/manifest.json')).toBe(false)
    expect(allowedRestorePath('../evil')).toBe(false)
    expect(allowedRestorePath('/etc/passwd')).toBe(false)
    expect(allowedRestorePath('Partitions/../x')).toBe(false)
    expect(allowedRestorePath('Partitions/w1\\Cookies')).toBe(false)
  })
})

describe('backup encryption (D61)', () => {
  const plain = Buffer.from('accounts and saved logins')

  it('round-trips through AES-256-GCM with a scrypt password', () => {
    const enc = encryptBackup(PW, plain, PARAMS)
    expect(enc.subarray(0, 9).toString()).toBe('GDBACKUP1')
    expect(decryptBackup(PW, enc)).toEqual(plain)
  })

  it('fails on a wrong password, a tampered ciphertext and a foreign file', () => {
    const enc = encryptBackup(PW, plain, PARAMS)
    expect(() => decryptBackup('another-password', enc)).toThrow(/Wrong password or damaged backup/)
    const tampered = Buffer.from(enc)
    tampered[tampered.length - 1] ^= 1
    expect(() => decryptBackup(PW, tampered)).toThrow(/Wrong password or damaged backup/)
    const magic = Buffer.from(enc)
    magic[0] = 0
    expect(() => decryptBackup(PW, magic)).toThrow(/not a GuiseDesk backup/)
    expect(() => decryptBackup(PW, enc.subarray(0, 20))).toThrow(/not a GuiseDesk backup/)
  })

  it('checks the export password and file name rules', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 8/)
    expect(passwordProblem(PW, 'different')).toMatch(/do not match/)
    expect(passwordProblem(PW, PW)).toBeNull()
    expect(backupFileName(new Date('2026-11-27T12:00:00Z'))).toBe('guisedesk-backup-2026-11-27.gdbackup')
    expect(backupDate('2026-11-27T12:00:00.000Z')).toBe('2026-11-27')
    expect(backupDate(undefined)).toBe('')
  })
})

describe('backup manifest and restore (D61)', () => {
  it('packs the metadata, extension ids and, on request, every partition file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-backup-'))
    seed(dir)
    const made = buildBackupArchive({ dataDir: dir, includeLogins: true, password: PW, version: '0.1.19', params: PARAMS, now: new Date('2026-11-27T12:00:00Z') })
    expect(made.manifest).toMatchObject({
      app: 'guisedesk',
      format: 1,
      version: '0.1.19',
      includeLogins: true,
      accounts: 2,
      settings: true,
      lock: true,
      extensions: [EXT_ID]
    })
    expect(inflateSync(decryptBackup(PW, made.bytes)).subarray(0, 6).toString()).toBe('GDTAR1')
    const entries = unpackArchive(inflateSync(decryptBackup(PW, made.bytes)))
    const paths = entries.map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining([
      'accounts.json',
      'settings.json',
      'lock.json',
      'manifest.json',
      'Partitions/w1/IndexedDB/https_web.whatsapp.com_0.indexeddb.leveldb/000003.log',
      'Partitions/w1/Local Storage/leveldb/000003.log'
    ]))
    expect(entries.find((e) => e.path.endsWith('Local Storage/leveldb/000003.log'))!.data.toString()).toBe('local-storage')
    expect(readArchiveManifest(entries)).toEqual(made.manifest)
    expect(inspectBackupBytes(PW, made.bytes)).toEqual(made.manifest)
    expect(() => inspectBackupBytes('wrong-password', made.bytes)).toThrow(/Wrong password/)
  })

  it('leaves partition data out when logins are not included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-backup-'))
    seed(dir)
    const made = buildBackupArchive({ dataDir: dir, includeLogins: false, password: PW, version: '0.1.19', params: PARAMS })
    const entries = unpackArchive(inflateSync(decryptBackup(PW, made.bytes)))
    expect(entries.some((e) => e.path.startsWith('Partitions/'))).toBe(false)
    expect(made.manifest.includeLogins).toBe(false)
    expect(made.manifest.accounts).toBe(2)
  })

  it('requires account data and a usable password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-backup-'))
    expect(() => buildBackupArchive({ dataDir: dir, includeLogins: false, password: PW, version: '0.1.19', params: PARAMS })).toThrow(/no account data/)
    seed(dir)
    expect(() => buildBackupArchive({ dataDir: dir, includeLogins: false, password: 'short', version: '0.1.19', params: PARAMS })).toThrow(/at least 8/)
  })

  it('stages a restore and applies it on the next start, replacing old data', () => {
    const source = mkdtempSync(join(tmpdir(), 'gd-backup-src-'))
    seed(source)
    const made = buildBackupArchive({ dataDir: source, includeLogins: true, password: PW, version: '0.1.19', params: PARAMS })
    const file = join(source, 'guisedesk-backup.gdbackup')
    writeFileSync(file, made.bytes)

    const target = mkdtempSync(join(tmpdir(), 'gd-backup-dst-'))
    writeFileSync(join(target, 'accounts.json'), JSON.stringify([{ id: 'old', label: 'Old' }]))
    writeFileSync(join(target, 'settings.json'), JSON.stringify({ selectedAccount: 'old' }))
    writeFileSync(join(target, 'lock.json'), JSON.stringify({ v: 1, kind: 'password' }))
    mkdirSync(join(target, 'Partitions', 'old'), { recursive: true })
    writeFileSync(join(target, 'Partitions', 'old', 'Cookies'), 'stale')
    mkdirSync(join(target, 'extensions', 'old'), { recursive: true })

    expect(prepareRestore({ dataDir: target, file, password: PW })).toEqual(made.manifest)
    expect(existsSync(join(target, PENDING_MARKER))).toBe(true)
    expect(existsSync(join(target, PENDING_ARCHIVE))).toBe(true)

    const applied = applyPendingRestore(target)!
    expect(applied).toMatchObject({ accounts: 2, includeLogins: true, extensions: [EXT_ID] })
    expect(JSON.parse(readFileSync(join(target, 'accounts.json'), 'utf8'))[0].id).toBe('w1')
    expect(JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8')).selectedAccount).toBe('w1')
    expect(JSON.parse(readFileSync(join(target, 'lock.json'), 'utf8')).kind).toBe('pin')
    expect(readFileSync(join(target, 'Partitions', 'w1', 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('local-storage')
    expect(existsSync(join(target, 'Partitions', 'old'))).toBe(false)
    expect(existsSync(join(target, 'extensions'))).toBe(false)
    expect(existsSync(join(target, PENDING_MARKER))).toBe(false)
    expect(existsSync(join(target, PENDING_ARCHIVE))).toBe(false)
    expect(applyPendingRestore(target)).toBeNull()
  })

  it('refuses partition data when the manifest says logins were not included', () => {
    const target = mkdtempSync(join(tmpdir(), 'gd-backup-logins-'))
    writeFileSync(join(target, 'accounts.json'), 'old-accounts')
    mkdirSync(join(target, 'Partitions', 'old'), { recursive: true })
    writeFileSync(join(target, 'Partitions', 'old', 'Cookies'), 'stale')

    const entries = packArchive([
      { path: 'accounts.json', data: Buffer.from('new-accounts') },
      { path: 'Partitions/w1/Cookies', data: Buffer.from('cookie') },
      { path: 'manifest.json', data: Buffer.from(JSON.stringify({ ...manifest, includeLogins: false })) }
    ])
    const file = join(target, 'tampered.gdbackup')
    writeFileSync(file, encryptBackup(PW, deflateSync(entries), PARAMS))

    expect(() => prepareRestore({ dataDir: target, file, password: PW })).toThrow(/saved logins/)
    expect(readFileSync(join(target, 'accounts.json'), 'utf8')).toBe('old-accounts')
    expect(existsSync(join(target, PENDING_MARKER))).toBe(false)

    writeFileSync(join(target, PENDING_ARCHIVE), entries)
    writeFileSync(join(target, PENDING_MARKER), JSON.stringify({ archive: PENDING_ARCHIVE }))
    expect(() => applyPendingRestore(target)).toThrow(/saved logins/)
    expect(readFileSync(join(target, 'accounts.json'), 'utf8')).toBe('old-accounts')
    expect(readFileSync(join(target, 'Partitions', 'old', 'Cookies'), 'utf8')).toBe('stale')
  })

  it('rejects a staged archive with a path outside the data dir', () => {
    const target = mkdtempSync(join(tmpdir(), 'gd-backup-bad-'))
    const manifestEntry = { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }
    const evil = { path: '../evil.txt', data: Buffer.from('x') }
    writeFileSync(join(target, PENDING_ARCHIVE), packArchive([evil, manifestEntry]))
    writeFileSync(join(target, PENDING_MARKER), JSON.stringify({ archive: PENDING_ARCHIVE }))
    expect(() => applyPendingRestore(target)).toThrow(/outside the app data/)
    expect(existsSync(join(target, PENDING_MARKER))).toBe(false)
    expect(existsSync(join(target, PENDING_ARCHIVE))).toBe(false)
    expect(existsSync(join(target, '..', 'evil.txt'))).toBe(false)
  })
})

describe('BackupDialog (D61)', () => {
  const exportBackup = vi.fn(async () => ({ ok: true as const, file: '/home/u/guisedesk-backup-2026-11-27.gdbackup', manifest }))
  const pickBackup = vi.fn(async () => ({ file: '/home/u/old.gdbackup' }))
  const inspectBackup = vi.fn(async () => ({ manifest }))
  const restoreBackup = vi.fn(async () => ({ ok: true as const, manifest }))

  beforeEach(() => {
    exportBackup.mockClear()
    pickBackup.mockClear()
    inspectBackup.mockClear()
    restoreBackup.mockClear()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = { exportBackup, pickBackup, inspectBackup, restoreBackup }
  })

  it('export asks for the password twice, checks it and includes logins only when ticked', async () => {
    const w = mount(BackupDialog, { props: { mode: 'export' } })
    const pw = w.find('input[aria-label="Backup password"]')
    const again = w.find('input[aria-label="Repeat backup password"]')
    await pw.setValue('short')
    await w.find('.btn.pri').trigger('click')
    expect(w.find('.err').text()).toMatch(/at least 8/)
    expect(exportBackup).not.toHaveBeenCalled()

    await pw.setValue(PW)
    await again.setValue('different')
    await w.find('.btn.pri').trigger('click')
    expect(w.find('.err').text()).toMatch(/do not match/)
    expect(exportBackup).not.toHaveBeenCalled()

    await again.setValue(PW)
    await w.find('.chk input').setValue(true)
    await w.find('.btn.pri').trigger('click')
    await flushPromises()
    expect(exportBackup).toHaveBeenCalledWith({ password: PW, includeLogins: true })
    expect(w.find('.done').text()).toContain('Backup saved to /home/u/guisedesk-backup-2026-11-27.gdbackup')
  })

  it('restore picks a file, shows the manifest, warns and then stages it', async () => {
    const w = mount(BackupDialog, { props: { mode: 'restore' } })
    await w.find('.btn').trigger('click')
    await flushPromises()
    expect(pickBackup).toHaveBeenCalledOnce()
    expect(w.text()).toContain('old.gdbackup')

    await w.find('input[aria-label="Backup password"]').setValue(PW)
    await w.findAll('.btn').find((b) => b.text() === 'Open backup')!.trigger('click')
    await flushPromises()
    expect(inspectBackup).toHaveBeenCalledWith({ file: '/home/u/old.gdbackup', password: PW })
    expect(w.text()).toContain('This backup contains')
    expect(w.text()).toContain('2026-11-27')
    expect(w.find('.warn').text()).toContain('replaces')
    expect(w.text()).toContain('Saved logins')

    await w.findAll('.btn').find((b) => b.text() === 'Restore and restart')!.trigger('click')
    await flushPromises()
    expect(restoreBackup).toHaveBeenCalledWith({ file: '/home/u/old.gdbackup', password: PW })
    expect(w.find('.done').text()).toContain('Restoring')
  })

  it('shows a wrong-password error from main', async () => {
    inspectBackup.mockResolvedValueOnce({ error: 'Wrong password or damaged backup.' } as never)
    const w = mount(BackupDialog, { props: { mode: 'restore' } })
    await w.find('.btn').trigger('click')
    await w.find('input[aria-label="Backup password"]').setValue('wrong-password')
    await w.findAll('.btn').find((b) => b.text() === 'Open backup')!.trigger('click')
    await flushPromises()
    expect(w.find('.err').text()).toBe('Wrong password or damaged backup.')
    expect(w.find('.manifest').exists()).toBe(false)
  })

  it('X, a click outside and Esc close it', async () => {
    const w = mount(BackupDialog, { props: { mode: 'export' } })
    await w.find('.ib.x').trigger('click')
    await w.find('.veil').trigger('click')
    await w.find('.glass').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(3)
  })
})

describe('Settings > General backup card (D61)', () => {
  it('opens the export and restore dialogs', async () => {
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      prefs: async () => ({ idleLock: 'manual', dnd: false, quietWorkHours: false, startOnLogin: false }),
      downloads: async () => ({ dir: '/dl', ask: false }),
      blocking: async () => ({ ads: false, popups: true })
    }
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const card = w.findAll('.card').find((c) => c.find('h4').text() === 'Backup')!
    expect(card).toBeTruthy()
    await card.findAll('.btn').find((b) => b.text() === 'Export backup...')!.trigger('click')
    expect(w.find('.backup h3').text()).toBe('Export backup')
    await w.find('.backup .ib.x').trigger('click')
    expect(w.find('.backup').exists()).toBe(false)
    await card.findAll('.btn').find((b) => b.text() === 'Restore backup...')!.trigger('click')
    expect(w.find('.backup h3').text()).toBe('Restore backup')
  })
})
