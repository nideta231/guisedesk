import { randomBytes } from 'node:crypto'
import * as nodeFs from 'node:fs'

export interface Fs {
  writeFileSync(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): void
  renameSync(from: string, to: string): void
  chmodSync(path: string, mode: number): void
  unlinkSync(path: string): void
}

/** A path next to the target with a random suffix, so two writers never share (or follow) a temp file. */
const tempFor = (path: string) => `${path}.${randomBytes(6).toString('hex')}.tmp`

/** Write via a fresh exclusive temp file then rename, so a crash never leaves a half-written file. With a mode, the file ends up with exactly that mode. */
export function writeAtomic(path: string, data: string | Uint8Array, fs: Fs = nodeFs, mode?: number): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tmp = tempFor(path)
    try {
      // 'wx' opens exclusively: an existing file or a planted symlink with this name is never followed.
      fs.writeFileSync(tmp, data, { flag: 'wx', ...(mode === undefined ? {} : { mode }) })
      if (mode !== undefined) fs.chmodSync(tmp, mode) // the requested mode is exact, not filtered by the umask
      fs.renameSync(tmp, path)
      return
    } catch (err) {
      // The random name was already taken by someone else: try another one, never touch theirs.
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') continue
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* the write never created it, or it is already gone */
      }
      throw err
    }
  }
  throw new Error(`could not create a temporary file for ${path}`)
}
