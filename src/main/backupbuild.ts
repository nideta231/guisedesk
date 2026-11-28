// Backup worker (D61): packing, decrypting and staging a large backup would freeze the UI, so they run here.
import { parentPort } from 'node:worker_threads'
import { handleBackupRequest, type BackupWorkerRequest } from './backupjob'

export type { BackupWorkerRequest } from './backupjob'

parentPort?.on('message', (m: BackupWorkerRequest) => parentPort?.postMessage(handleBackupRequest(m)))
