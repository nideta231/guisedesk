import * as nodeFs from 'node:fs'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cacheFavicon, readIcon } from '../src/main/favicon'

const tmp = () => mkdtempSync(join(tmpdir(), 'gd-fav-'))
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

describe('favicon cache', () => {
  it('fetches the site favicon once, caches it in the data dir and reuses it', async () => {
    const dir = tmp()
    const urls: string[] = []
    const fetcher = async (u: string) => (urls.push(u), { contentType: 'image/png', bytes: png })
    const icon = await cacheFavicon(dir, 'https://wiki.example.com/start', fetcher)
    expect(urls).toEqual(['https://wiki.example.com/favicon.ico'])
    expect(icon).toBe('icons/wiki.example.com.png')
    expect(existsSync(join(dir, icon!))).toBe(true)
    expect(await cacheFavicon(dir, 'https://wiki.example.com/other', fetcher)).toBe(icon)
    expect(urls).toHaveLength(1)
    expect(readIcon(dir, icon)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  })

  it('caches an icon for an IPv6 custom site under a slug that readIcon accepts', async () => {
    const dir = tmp()
    const icon = await cacheFavicon(dir, 'http://[::1]:8080/', async () => ({ contentType: 'image/png', bytes: png }))
    expect(icon).toBe('icons/___1_.png')
    expect(readIcon(dir, icon)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  })

  it('writes the icon atomically: a failed rename leaves no new icon and the previous one intact', async () => {
    const dir = tmp()
    const first = await cacheFavicon(dir, 'https://a.example.com/', async () => ({ contentType: 'image/png', bytes: png }))
    expect(first).toBe('icons/a.example.com.png')
    const fs = {
      ...nodeFs,
      renameSync: () => {
        throw new Error('disk full')
      }
    }
    const failed = await cacheFavicon(dir, 'https://b.example.com/', async () => ({ contentType: 'image/svg+xml', bytes: new Uint8Array([1, 2, 3]) }), fs)
    expect(failed).toBeUndefined()
    expect(existsSync(join(dir, 'icons/b.example.com.svg'))).toBe(false)
    expect(readIcon(dir, first)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  })

  it('falls back to no icon when the fetch fails or returns a non-image', async () => {
    const dir = tmp()
    expect(await cacheFavicon(dir, 'https://a.example.com/', async () => null)).toBeUndefined()
    expect(await cacheFavicon(dir, 'https://a.example.com/', async () => { throw new Error('offline') })).toBeUndefined()
    expect(await cacheFavicon(dir, 'https://a.example.com/', async () => ({ contentType: 'text/html', bytes: png }))).toBeUndefined()
    expect(existsSync(join(dir, 'icons'))).toBe(false)
    expect(readIcon(dir, undefined)).toBeUndefined()
    expect(readIcon(dir, '../accounts.json')).toBeUndefined()
  })
})
