// Backup and restore (D61). One encrypted file holds accounts.json, settings.json, lock.json, the installed
// extension ids and, on request, the whole Partitions folder. The archive is a small tar-like format deflated with
// zlib, then encrypted. Plain TS, no electron import: the format, crypto and restore steps are tested directly, and
// the packer runs in a worker thread.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { writeAtomic } from './atomic'
import { extensionsDir, listInstalled } from './extensions'
import { MIN_BACKUP_PASSWORD, passwordProblem } from './backuprules'

const FILE_MAGIC = Buffer.from('GDBACKUP1', 'latin1')
const ARCHIVE_MAGIC = Buffer.from('GDTAR1', 'latin1')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export interface ScryptParams {
  N: number
  r: number
  p: number
}

/** Real backups use a fresh 16-byte salt and scrypt at N=16384; tests pass a cheaper N. */
export const DEFAULT_BACKUP_SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1 }

export const PENDING_MARKER = 'restore-pending.json'
export const PENDING_ARCHIVE = 'restore-pending.gdtar'

export interface BackupEntry {
  /** Forward-slash path inside the data dir (metadata file or Partitions/...). */
  path: string
  data: Buffer
}

export interface BackupManifest {
  app: 'guisedesk'
  format: 1
  created: string
  version: string
  includeLogins: boolean
  accounts: number
  settings: boolean
  lock: boolean
  /** Installed extension ids; restore downloads them again (the files are not in the backup). */
  extensions: string[]
  files: number
  bytes: number
}

export interface BackupInput {
  dataDir: string
  includeLogins: boolean
  password: string
  version: string
  now?: Date
  params?: ScryptParams
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

/** Packs entries into a tiny tar-like format: GDTAR1, then name length/name/data length/data, then a zero name. */
export function packArchive(entries: BackupEntry[]): Buffer {
  const parts: Buffer[] = [ARCHIVE_MAGIC]
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const name = Buffer.from(e.path, 'utf8')
    if (!name.length || name.length > 0xffff) throw new Error('A backup entry has an unusable name.')
    if (!Buffer.isBuffer(e.data)) throw new Error('A backup entry has no data.')
    parts.push(u32(name.length), name, u32(e.data.length), e.data)
  }
  parts.push(u32(0))
  return Buffer.concat(parts)
}

/** Reads the archive format back; corrupt or truncated files are rejected instead of half-read. */
export function unpackArchive(buf: Buffer): BackupEntry[] {
  if (!Buffer.isBuffer(buf) || buf.length < ARCHIVE_MAGIC.length || !buf.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)) {
    throw new Error('The backup archive is not valid.')
  }
  const out: BackupEntry[] = []
  let at = ARCHIVE_MAGIC.length
  const need = (n: number) => {
    if (at + n > buf.length) throw new Error('The backup archive is truncated.')
  }
  while (at < buf.length) {
    need(4)
    const nameLen = buf.readUInt32BE(at)
    at += 4
    if (nameLen === 0) {
      if (at !== buf.length) throw new Error('The backup archive has trailing data.')
      return out
    }
    if (nameLen > 0xffff) throw new Error('The backup archive has an unusable name.')
    need(nameLen + 4)
    const name = buf.subarray(at, at + nameLen).toString('utf8')
    at += nameLen
    const dataLen = buf.readUInt32BE(at)
    at += 4
    need(dataLen)
    out.push({ path: name, data: buf.subarray(at, at + dataLen) })
    at += dataLen
  }
  throw new Error('The backup archive is truncated.')
}

function saneParams(p: ScryptParams): boolean {
  return (
    Number.isInteger(p.N) && p.N >= 1024 && p.N <= 1 << 20 && (p.N & (p.N - 1)) === 0 &&
    Number.isInteger(p.r) && p.r >= 1 && p.r <= 32 &&
    Number.isInteger(p.p) && p.p >= 1 && p.p <= 16
  )
}

function derive(password: string, salt: Buffer, p: ScryptParams): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, KEY_LEN, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r })
}

/** File layout: magic, salt length/salt, N/r/p, IV, GCM tag, ciphertext. */
export function encryptBackup(password: string, plain: Buffer, params: ScryptParams = DEFAULT_BACKUP_SCRYPT): Buffer {
  if (passwordProblem(password, password)) throw new Error(`Use at least ${MIN_BACKUP_PASSWORD} characters.`)
  if (!saneParams(params)) throw new Error('Unusable backup encryption parameters.')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', derive(password, salt, params), iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([
    FILE_MAGIC,
    Buffer.from([SALT_LEN]),
    salt,
    u32(params.N),
    u32(params.r),
    u32(params.p),
    iv,
    cipher.getAuthTag(),
    ciphertext
  ])
}

/** Decrypts one backup file; wrong password and a damaged ciphertext both fail the GCM check. */
export function decryptBackup(password: string, file: Buffer): Buffer {
  const head = FILE_MAGIC.length
  if (!Buffer.isBuffer(file) || file.length < head + 1 + SALT_LEN + 12 + IV_LEN + TAG_LEN) {
    throw new Error('This is not a GuiseDesk backup.')
  }
  if (!file.subarray(0, head).equals(FILE_MAGIC)) throw new Error('This is not a GuiseDesk backup.')
  let at = head
  const saltLen = file[at++]
  if (saltLen < 1 || saltLen > 64) throw new Error('This is not a GuiseDesk backup.')
  if (at + saltLen + 12 + IV_LEN + TAG_LEN > file.length) throw new Error('This is not a GuiseDesk backup.')
  const salt = file.subarray(at, at + saltLen)
  at += saltLen
  const params = { N: file.readUInt32BE(at), r: file.readUInt32BE(at + 4), p: file.readUInt32BE(at + 8) }
  at += 12
  if (!saneParams(params)) throw new Error('This is not a GuiseDesk backup.')
  const iv = file.subarray(at, at + IV_LEN)
  at += IV_LEN
  const tag = file.subarray(at, at + TAG_LEN)
  at += TAG_LEN
  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(password, salt, params), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(file.subarray(at)), decipher.final()])
  } catch {
    throw new Error('Wrong password or damaged backup.')
  }
}

/** Paths a restore is allowed to write: the three metadata files and anything under Partitions/. */
export function allowedRestorePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/')) return false
  const parts = path.split('/')
  if (parts.some((p) => !p || p === '.' || p === '..')) return false
  if (parts.length === 1) return parts[0] === 'accounts.json' || parts[0] === 'settings.json' || parts[0] === 'lock.json'
  return parts[0] === 'Partitions' && parts.length > 1
}

function readIf(path: string): Buffer | undefined {
  try {
    return readFileSync(path)
  } catch {
    return undefined
  }
}

function partitionEntries(dataDir: string, root = join(dataDir, 'Partitions'), out: BackupEntry[] = []): BackupEntry[] {
  if (!existsSync(root)) return out
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, d.name)
    if (d.isDirectory()) partitionEntries(dataDir, full, out)
    else if (d.isFile()) {
      const data = readIf(full)
      if (data) out.push({ path: relative(dataDir, full).split(sep).join('/'), data })
    }
  }
  return out
}

function accountCount(data: Buffer | undefined): number {
  if (!data) return 0
  try {
    const v = JSON.parse(data.toString('utf8'))
    return Array.isArray(v) ? v.length : 0
  } catch {
    return 0
  }
}

/** The manifest for an archive: what the restore dialog shows and what startup needs (extension ids, flags). */
function makeManifest(input: BackupInput, entries: BackupEntry[], settings: boolean, lock: boolean): BackupManifest {
  return {
    app: 'guisedesk',
    format: 1,
    created: (input.now ?? new Date()).toISOString(),
    version: input.version,
    includeLogins: input.includeLogins,
    accounts: accountCount(entries.find((e) => e.path === 'accounts.json')?.data),
    settings,
    lock,
    extensions: listInstalled(extensionsDir(input.dataDir)).map((x) => x.id),
    files: entries.length,
    bytes: entries.reduce((n, e) => n + e.data.length, 0)
  }
}

/** Reads the data dir, packs it and encrypts it. Throws when there is no account data yet. */
export function buildBackupArchive(input: BackupInput): { bytes: Buffer; manifest: BackupManifest } {
  if (passwordProblem(input.password, input.password)) throw new Error(`Use at least ${MIN_BACKUP_PASSWORD} characters.`)
  const accounts = readIf(join(input.dataDir, 'accounts.json'))
  if (!accounts) throw new Error('There is no account data to back up yet.')
  const settings = readIf(join(input.dataDir, 'settings.json'))
  const lock = readIf(join(input.dataDir, 'lock.json'))
  const entries: BackupEntry[] = [{ path: 'accounts.json', data: accounts }]
  if (settings) entries.push({ path: 'settings.json', data: settings })
  if (lock) entries.push({ path: 'lock.json', data: lock })
  if (input.includeLogins) entries.push(...partitionEntries(input.dataDir))
  const manifest = makeManifest(input, entries, !!settings, !!lock)
  entries.push({ path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) })
  // The archive is deflated before encryption: partition folders compress well, and the result stays one file.
  return { bytes: encryptBackup(input.password, deflateSync(packArchive(entries)), input.params), manifest }
}

/** The manifest stored inside an unpacked archive; malformed or foreign archives are rejected. */
export function readArchiveManifest(entries: BackupEntry[]): BackupManifest {
  const entry = entries.find((e) => e.path === 'manifest.json')
  if (!entry) throw new Error('The backup has no manifest.')
  let m: Partial<BackupManifest>
  try {
    m = JSON.parse(entry.data.toString('utf8'))
  } catch {
    throw new Error('The backup manifest is not valid.')
  }
  if (!m || m.app !== 'guisedesk' || m.format !== 1) throw new Error('This backup was made by a different app or version.')
  if (typeof m.created !== 'string' || typeof m.version !== 'string' || typeof m.includeLogins !== 'boolean' ||
      typeof m.accounts !== 'number' || typeof m.settings !== 'boolean' || typeof m.lock !== 'boolean' ||
      !Array.isArray(m.extensions) || m.extensions.some((x) => typeof x !== 'string') ||
      typeof m.files !== 'number' || typeof m.bytes !== 'number') {
    throw new Error('The backup manifest is not valid.')
  }
  return m as BackupManifest
}

/** Decrypts and reads only the manifest, for the restore dialog's "what it contains" step. */
export function inspectBackupBytes(password: string, file: Buffer): BackupManifest {
  return readArchiveManifest(unpackArchive(inflateSync(decryptBackup(password, file))))
}

/**
 * Stages a restore: decrypts the file, inflates and validates it, writes the plaintext archive inside the data dir
 * (mode 0600, so the password is not stored) and a marker. The next start applies it before any session exists.
 */
export function prepareRestore(input: { dataDir: string; file: string; password: string }): BackupManifest {
  const plain = inflateSync(decryptBackup(input.password, readFileSync(input.file)))
  const entries = unpackArchive(plain)
  const manifest = readArchiveManifest(entries)
  for (const e of entries) if (e.path !== 'manifest.json' && !allowedRestorePath(e.path)) throw new Error('The backup contains a file outside the app data.')
  writeAtomic(join(input.dataDir, PENDING_ARCHIVE), plain, undefined, 0o600)
  writeAtomic(join(input.dataDir, PENDING_MARKER), JSON.stringify({ archive: PENDING_ARCHIVE, created: new Date().toISOString(), manifest }, null, 2), undefined, 0o600)
  return manifest
}

function pendingArchivePath(dataDir: string, info: unknown): string {
  const name = info && typeof info === 'object' && typeof (info as { archive?: unknown }).archive === 'string'
    ? (info as { archive: string }).archive
    : PENDING_ARCHIVE
  if (name !== PENDING_ARCHIVE) throw new Error('The pending restore is not valid.')
  return join(dataDir, name)
}

/**
 * Applies a staged restore: replaces accounts/settings/lock and Partitions, drops the old extension files and the
 * stale login record. Runs before the lock, sessions and window are created. On failure the pending files are
 * removed so a broken restore cannot loop on every start.
 */
export function applyPendingRestore(dataDir: string): BackupManifest | null {
  const marker = join(dataDir, PENDING_MARKER)
  if (!existsSync(marker)) return null
  let archivePath = ''
  try {
    const info = JSON.parse(readFileSync(marker, 'utf8'))
    archivePath = pendingArchivePath(dataDir, info)
    const entries = unpackArchive(readFileSync(archivePath))
    const manifest = readArchiveManifest(entries)
    const files = entries.filter((e) => e.path !== 'manifest.json')
    for (const e of files) if (!allowedRestorePath(e.path)) throw new Error('The backup contains a file outside the app data.')
    // A backup replaces the current accounts, sessions and extension files; absent settings/lock mean setup.
    rmSync(join(dataDir, 'Partitions'), { recursive: true, force: true })
    rmSync(join(dataDir, 'extensions'), { recursive: true, force: true })
    rmSync(join(dataDir, 'logins.json'), { force: true })
    if (!manifest.settings) rmSync(join(dataDir, 'settings.json'), { force: true })
    if (!manifest.lock) rmSync(join(dataDir, 'lock.json'), { force: true })
    for (const e of files) {
      const dest = join(dataDir, ...e.path.split('/'))
      if (e.path.includes('/')) mkdirSync(dirname(dest), { recursive: true })
      // lock.json and settings.json (proxy passwords) are private; the rest keep the usual mode.
      writeAtomic(dest, e.data, undefined, e.path === 'lock.json' || e.path === 'settings.json' ? 0o600 : undefined)
    }
    rmSync(marker, { force: true })
    rmSync(archivePath, { force: true })
    return manifest
  } catch (err) {
    rmSync(marker, { force: true })
    rmSync(join(dataDir, PENDING_ARCHIVE), { force: true })
    if (archivePath) rmSync(archivePath, { force: true })
    throw err
  }
}
