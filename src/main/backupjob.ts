// Backup worker jobs without the worker: plain TS so the request handler can be tested directly.
import { readFileSync } from 'node:fs'
import { inspectBackupBytes, prepareRestore, writeBackup, type BackupManifest } from './backup'

export type BackupWorkerRequest =
  | { op: 'export'; dataDir: string; file: string; includeLogins: boolean; password: string; version: string }
  | { op: 'inspect'; file: string; password: string }
  | { op: 'prepare'; dataDir: string; file: string; password: string }

export interface BackupWorkerReply {
  ok: boolean
  manifest?: BackupManifest
  error?: string
}

export function handleBackupRequest(m: BackupWorkerRequest): BackupWorkerReply {
  try {
    if (m.op === 'export') return { ok: true, manifest: writeBackup(m.file, { dataDir: m.dataDir, includeLogins: m.includeLogins, password: m.password, version: m.version }) }
    if (m.op === 'inspect') return { ok: true, manifest: inspectBackupBytes(m.password, readFileSync(m.file)) }
    if (m.op === 'prepare') return { ok: true, manifest: prepareRestore({ dataDir: m.dataDir, file: m.file, password: m.password }) }
    return { ok: false, error: 'Unknown backup operation.' }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}
