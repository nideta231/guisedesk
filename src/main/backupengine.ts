// Electron side of backup (D61): one worker per operation, so packing, decrypting and staging never block main.
import createBackupWorker from './backupbuild?nodeWorker'
import type { BackupWorkerRequest } from './backupbuild'
import type { BackupManifest } from './backup'

export interface BackupWorkerResult {
  manifest?: BackupManifest
}

export function runBackupWorker(req: BackupWorkerRequest): Promise<BackupWorkerResult> {
  return new Promise((resolve, reject) => {
    const w = createBackupWorker({})
    const t = setTimeout(() => {
      void w.terminate()
      reject(new Error('The backup took too long.'))
    }, 10 * 60_000)
    w.once('message', (m: { ok: boolean; manifest?: BackupManifest; error?: string }) => {
      clearTimeout(t)
      void w.terminate()
      if (!m.ok) return reject(new Error(m.error ?? 'The backup failed.'))
      resolve({ ...(m.manifest ? { manifest: m.manifest } : {}) })
    })
    w.once('error', (e: Error) => {
      clearTimeout(t)
      void w.terminate()
      reject(e)
    })
    w.postMessage(req)
  })
}
