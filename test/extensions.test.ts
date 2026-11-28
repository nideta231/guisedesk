// @vitest-environment jsdom
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { actionClick, checkExtensionUpdates, compareVersions, createExtensionFetcher, enabledFor, listInstalled, loadUpdateTimes, parseExtensionId, parseUpdateVersion, readManifest, readyCopy, reloadEverywhere, saveUpdateTimes, toggled, updateCheckUrl } from '../src/main/extensions'
import { appendEvent, lostLogins } from '../src/main/events'
import SettingsExtensions from '../src/renderer/src/SettingsExtensions.vue'

const WAWP = 'ekcgkejcjdcmonfpmnljobemcbpnkamh'

describe('extensions (D49)', () => {
  it('parses store links (new and old) and bare ids; rejects others', () => {
    expect(parseExtensionId('https://chromewebstore.google.com/detail/wa-web-plus-by-elbruz-tec/ekcgkejcjdcmonfpmnljobemcbpnkamh?hl=en')).toBe(WAWP)
    expect(parseExtensionId('https://chrome.google.com/webstore/detail/x/ekcgkejcjdcmonfpmnljobemcbpnkamh')).toBe(WAWP)
    expect(parseExtensionId(' ' + WAWP + ' ')).toBe(WAWP)
    expect(parseExtensionId('https://evil.example/detail/x/ekcgkejcjdcmonfpmnljobemcbpnkamh')).toBeNull()
    expect(parseExtensionId('hello')).toBeNull()
  })
  it('enabledFor keeps only installed ids; toggled adds and removes once', () => {
    expect(enabledFor({ extensions: [WAWP, 'zzz'] }, [WAWP])).toEqual([WAWP])
    expect(enabledFor({}, [WAWP])).toEqual([])
    expect(toggled(undefined, WAWP, true)).toEqual([WAWP])
    expect(toggled([WAWP], WAWP, true)).toEqual([WAWP])
    expect(toggled([WAWP], WAWP, false)).toEqual([])
  })
  it('listInstalled reads names (with __MSG_ locales) and versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    const d = join(root, WAWP, '5.2.9_0')
    mkdirSync(join(d, '_locales', 'en'), { recursive: true })
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ name: '__MSG_appName__', default_locale: 'en' }))
    writeFileSync(join(d, '_locales', 'en', 'messages.json'), JSON.stringify({ appName: { message: 'WA Web Plus' } }))
    mkdirSync(join(root, 'not-an-id'))
    expect(listInstalled(root).map(({ id, name, version }) => ({ id, name, version }))).toEqual([{ id: WAWP, name: 'WA Web Plus', version: '5.2.9' }])
  })
})

describe('toolbar click target (D54)', () => {
  it('opens the popup of an MV3 action or MV2 browser_action that declares default_popup', () => {
    expect(actionClick({ manifest_version: 3, action: { default_popup: 'popup.html' } })).toEqual({ kind: 'popup', popup: 'popup.html' })
    expect(actionClick({ manifest_version: 2, browser_action: { default_popup: ' ui.html ' } })).toEqual({ kind: 'popup', popup: 'ui.html' })
  })
  it('dispatches onClicked when there is no popup, a blank one, or no declarative action at all', () => {
    expect(actionClick({ manifest_version: 3, action: {} })).toEqual({ kind: 'onClicked' })
    expect(actionClick({ manifest_version: 3, action: { default_popup: '  ' } })).toEqual({ kind: 'onClicked' })
    expect(actionClick({ manifest_version: 3, action: 'x' })).toEqual({ kind: 'onClicked' })
    expect(actionClick({ manifest_version: 2, action: { default_popup: 'wrong-key.html' } })).toEqual({ kind: 'onClicked' })
    expect(actionClick({ manifest_version: 3, browser_action: { default_popup: 'wrong-key.html' } })).toEqual({ kind: 'onClicked' })
    expect(actionClick(null)).toEqual({ kind: 'onClicked' })
  })
  it('readManifest reads a real folder and survives a missing manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ name: 'WA Web Plus', manifest_version: 3 }))
    expect(readManifest(root)).toMatchObject({ name: 'WA Web Plus', manifest_version: 3 })
    expect(readManifest(join(root, 'nope'))).toEqual({})
  })
})

describe('extension auto-update (D56)', () => {
  const A = 'a'.repeat(32)
  const B = 'b'.repeat(32)
  const row = (id: string, name: string, version: string) => ({ id, name, version, path: `/x/${id}/${version}_0` })
  const unpack = (root: string, id: string, name: string) => {
    const d = join(root, id, name)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'manifest.json'), '{}')
    return d
  }

  it('builds the Chrome Web Store update-service URL', () => {
    expect(updateCheckUrl(WAWP, '146.0.0.0')).toBe(
      'https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=146.0.0.0&acceptformat=crx2,crx3&x=id%3D' + WAWP + '%26uc'
    )
  })

  it('parses the version from update-check XML and rejects bad answers', () => {
    expect(parseUpdateVersion('<gupdate><updatecheck status="ok" version="5.2.10"/></gupdate>')).toBe('5.2.10')
    expect(parseUpdateVersion("<updatecheck version='1.2'/>")).toBe('1.2')
    expect(parseUpdateVersion('<updatecheck status="noupdate"/>')).toBeNull()
    expect(parseUpdateVersion('<updatecheck version="beta"/>')).toBeNull()
    expect(parseUpdateVersion('')).toBeNull()
  })

  it('checks every installed extension and keeps only versions that are newer', async () => {
    const installed = [row(A, 'A', '5.2.9'), row(B, 'B', '1.0')]
    const urls: string[] = []
    const got = await checkExtensionUpdates({
      installed,
      chromeVersion: '146',
      fetchText: async (url) => {
        urls.push(url)
        return url.includes(A) ? '<updatecheck version="5.2.10"/>' : '<updatecheck version="1.0"/>'
      }
    })
    expect(got).toEqual([{ id: A, current: '5.2.9', version: '5.2.10' }])
    expect(urls).toHaveLength(2)
  })

  it('one failed answer does not hide another extension update', async () => {
    const got = await checkExtensionUpdates({
      installed: [row(A, 'A', '5.2.9'), row(B, 'B', '1.0')],
      chromeVersion: '146',
      fetchText: async (url) => {
        if (url.includes(A)) throw new Error('offline')
        return '<updatecheck version="1.1"/>'
      }
    })
    expect(got).toEqual([{ id: B, current: '1.0', version: '1.1' }])
  })

  it('stores and reads the last update dates', () => {
    const d = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    expect(loadUpdateTimes(d)).toEqual({})
    saveUpdateTimes(d, { [A]: '2026-11-27' })
    expect(loadUpdateTimes(d)).toEqual({ [A]: '2026-11-27' })
  })

  it('force downloads a new copy even when an old one is installed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    unpack(root, WAWP, '5.2.9_0')
    const download = vi.fn(async (id: string, dir: string) => unpack(dir, id, '5.2.10_0'))
    const fetch = createExtensionFetcher(root, download)
    expect(await fetch(WAWP)).toBe(join(root, WAWP, '5.2.9_0'))
    expect(download).not.toHaveBeenCalled()
    expect(await fetch(WAWP, true)).toBe(join(root, WAWP, '5.2.10_0'))
    expect(download).toHaveBeenCalledOnce()
  })

  it('a failed new copy is rolled back to the old path in the sessions that had it', async () => {
    const loaded: string[] = []
    const installed = new Set([A])
    const ses = {
      extensions: {
        getExtension: (id: string) => (installed.has(id) ? {} : undefined),
        removeExtension: (id: string) => void installed.delete(id),
        loadExtension: async (path: string) => {
          loaded.push(path)
          if (path === '/new/A') throw new Error('bad manifest')
          installed.add(A)
          return {}
        }
      }
    }
    expect(await reloadEverywhere([ses], A, '/new/A', '/old/A')).toEqual({ ok: false, failed: 1 })
    expect(loaded).toEqual(['/new/A', '/old/A'])
    expect(installed.has(A)).toBe(true)
  })

  it('one failing session rolls every touched session back to the old path', async () => {
    const loaded: string[] = []
    const fake = (name: string, fail: boolean) => {
      let on = true
      return {
        name,
        extensions: {
          getExtension: () => (on ? {} : undefined),
          removeExtension: () => void (on = false),
          loadExtension: async (path: string) => {
            loaded.push(`${name} ${path}`)
            if (fail && path === '/new/A') throw new Error('bad manifest')
            on = true
            return {}
          }
        }
      }
    }
    const ok = fake('ok', false)
    const bad = fake('bad', true)
    expect(await reloadEverywhere([ok, bad], A, '/new/A', '/old/A')).toEqual({ ok: false, failed: 1 })
    expect(loaded).toEqual(['ok /new/A', 'bad /new/A', 'ok /old/A', 'bad /old/A'])
    expect(ok.extensions.getExtension()).toBeTruthy()
    expect(bad.extensions.getExtension()).toBeTruthy()
  })

  it('a good update loads the new path once and leaves the sessions that did not have it alone', async () => {
    const loaded: string[] = []
    const withA = {
      extensions: {
        getExtension: (id: string) => (id === A ? {} : undefined),
        removeExtension: () => undefined,
        loadExtension: async (path: string) => (loaded.push(path), {})
      }
    }
    const withoutA = {
      extensions: {
        getExtension: () => undefined,
        removeExtension: () => { throw new Error('must not touch') },
        loadExtension: async () => { throw new Error('must not touch') }
      }
    }
    expect(await reloadEverywhere([withA, withoutA], A, '/new/A', '/old/A')).toEqual({ ok: true, failed: 0 })
    expect(loaded).toEqual(['/new/A'])
  })
})

describe('Settings > Extensions', () => {
  it('adds from a link, toggles per account and removes', async () => {
    const row = { id: WAWP, name: 'WA Web Plus', version: '5.2.9' }
    const acc = { id: 'wa1', serviceId: 'whatsapp', label: 'Personal', colour: '#000', order: 0 }
    const setExtension = vi.fn(async () => ({ accounts: [{ ...acc, extensions: [WAWP] }], disabledServices: [] }))
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      extensions: async () => [],
      installExtension: vi.fn(async () => ({ ok: true, list: [row] })),
      removeExtension: vi.fn(async () => []),
      setExtension
    }
    const w = mount(SettingsExtensions, { props: { accounts: [acc] } })
    await flushPromises()
    expect(w.text()).toContain('No extensions yet')
    await w.find('input').setValue('https://chromewebstore.google.com/detail/x/' + WAWP)
    await w.find('.btn.pri').trigger('click')
    await flushPromises()
    const card = w.find(`[data-ext="${WAWP}"]`)
    expect(card.text()).toContain('WA Web Plus')
    await card.find('.tg').trigger('click')
    await flushPromises()
    expect(setExtension).toHaveBeenCalledWith('wa1', WAWP, true)
    expect(w.find(`[data-ext="${WAWP}"] .tg`).classes()).toContain('on')
    await w.find(`[data-ext="${WAWP}"] .btn`).trigger('click')
    await flushPromises()
    expect(w.find(`[data-ext="${WAWP}"]`).exists()).toBe(false)
  })
  it('shows the version with its updated date and checks for updates on demand', async () => {
    const row = { id: WAWP, name: 'WA Web Plus', version: '5.2.10', updated: '2026-11-27' }
    const check = vi.fn(async () => ({ checked: 1, updated: [{ id: WAWP, version: '5.2.10' }] }))
    ;(window as unknown as { guisedesk: unknown }).guisedesk = { extensions: async () => [row], checkExtensionUpdates: check }
    const w = mount(SettingsExtensions, { props: { accounts: [] } })
    await flushPromises()
    expect(w.find(`[data-ext="${WAWP}"] .updated`).text()).toBe('Updated 2026-11-27')
    await w.find('.btn').trigger('click')
    await flushPromises()
    expect(check).toHaveBeenCalledOnce()
    expect(w.text()).toContain('1 updated: WA Web Plus 5.2.10')
  })

  it('a bad link shows the error from main', async () => {
    ;(window as unknown as { guisedesk: unknown }).guisedesk = {
      extensions: async () => [],
      installExtension: async () => ({ error: 'Paste a Chrome Web Store link' })
    }
    const w = mount(SettingsExtensions, { props: { accounts: [] } })
    await flushPromises()
    await w.find('input').setValue('nope')
    await w.find('.btn.pri').trigger('click')
    await flushPromises()
    expect(w.find('.hint.warn').text()).toBe('Paste a Chrome Web Store link')
  })
})

describe('events log (D50)', () => {
  it('lostLogins reports only logins present before and gone now', () => {
    expect(lostLogins({ a: true, b: true, c: false }, { a: false, b: true, c: false, d: false })).toEqual(['a'])
  })
  it('appendEvent writes timestamped lines', () => {
    const d = mkdtempSync(join(tmpdir(), 'gd-ev-'))
    appendEvent(d, 'start v1', new Date('2026-11-27T01:00:00Z'))
    appendEvent(d, 'quit\nx', new Date('2026-11-27T01:00:05Z'))
    expect(readFileSync(join(d, 'events.log'), 'utf8')).toBe('2026-11-27T01:00:00.000Z start v1\n2026-11-27T01:00:05.000Z quit x\n')
  })
  it('creates events.log with mode 0600 and keeps it across rotation', () => {
    const d = mkdtempSync(join(tmpdir(), 'gd-ev-'))
    appendEvent(d, 'start v1')
    expect(statSync(join(d, 'events.log')).mode & 0o777).toBe(0o600)
    writeFileSync(join(d, 'events.log'), 'x'.repeat(512 * 1024 + 1))
    appendEvent(d, 'after rotation')
    expect(statSync(join(d, 'events.log')).mode & 0o777).toBe(0o600)
    expect(statSync(join(d, 'events.log.1')).mode & 0o777).toBe(0o600)
  })
})

describe('extension download (D49)', () => {
  const unpack = (root: string, id: string, name: string, manifest = true) => {
    const d = join(root, id, name)
    mkdirSync(d, { recursive: true })
    if (manifest) writeFileSync(join(d, 'manifest.json'), '{}')
    return d
  }
  it('readyCopy picks the newest complete version and removes leftovers of a broken install', () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    unpack(root, WAWP, '1fa783e5-bcb5-4cfc-b5a6-245578a01099')
    unpack(root, WAWP, '5.2.10_0', false)
    unpack(root, WAWP, '5.2.8_0')
    const best = unpack(root, WAWP, '5.2.9_0')
    expect(readyCopy(root, WAWP)).toBe(best)
    expect(readdirSync(join(root, WAWP)).sort()).toEqual(['5.2.8_0', '5.2.9_0'])
    expect(readyCopy(root, 'none')).toBeNull()
    expect(compareVersions([5, 2, 10], [5, 2, 9])).toBeGreaterThan(0)
  })
  it('the ENOTEMPTY case: an empty version folder left by a failed rename is cleared, then downloaded once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    unpack(root, WAWP, '1fa783e5-bcb5-4cfc-b5a6-245578a01099')
    unpack(root, WAWP, '5.2.9_0', false)
    const download = vi.fn(async (id: string, dir: string) => {
      expect(existsSync(join(dir, id, '5.2.9_0'))).toBe(false)
      return unpack(dir, id, '5.2.9_0')
    })
    const fetch = createExtensionFetcher(root, download)
    const [a, b, c] = await Promise.all([fetch(WAWP), fetch(WAWP), fetch(WAWP)])
    expect(download).toHaveBeenCalledOnce()
    expect(a).toBe(b); expect(b).toBe(c)
    expect(await fetch(WAWP)).toBe(a)
    expect(download).toHaveBeenCalledOnce()
  })
  it('a scan keeps a freshly touched download folder and prunes it once its mtime is old', () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    unpack(root, WAWP, '5.2.9_0')
    const temp = unpack(root, WAWP, '9b7a5e0c-1c3d-4a5b-8e9f-0a1b2c3d4e5f', false)
    expect(listInstalled(root).map((x) => x.id)).toEqual([WAWP])
    expect(existsSync(temp)).toBe(true)
    const old = new Date(Date.now() - 11 * 60_000)
    utimesSync(temp, old, old)
    expect(listInstalled(root).map((x) => x.id)).toEqual([WAWP])
    expect(existsSync(temp)).toBe(false)
  })
  it('removing during an in-flight download deletes it again and the next fetch starts fresh', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gd-ext-'))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const download = vi.fn(async (id: string, dir: string) => {
      await gate
      return unpack(dir, id, '5.2.9_0')
    })
    const fetch = createExtensionFetcher(root, download)
    const first = fetch(WAWP)
    const removed = fetch.remove(WAWP)
    release()
    await first
    await removed
    expect(listInstalled(root)).toEqual([])
    expect(existsSync(join(root, WAWP))).toBe(false)
    expect(await fetch(WAWP)).toBe(join(root, WAWP, '5.2.9_0'))
    expect(download).toHaveBeenCalledTimes(2)
    expect(listInstalled(root).map((x) => x.id)).toEqual([WAWP])
  })
})

describe('TopBar puzzle chip', () => {
  it('shows while awake and emits extensions', async () => {
    const { default: TopBar } = await import('../src/renderer/src/TopBar.vue')
    const acc = { id: 'wa1', serviceId: 'whatsapp', label: 'P', colour: '#000', order: 0 }
    const w = mount(TopBar, { props: { account: acc, asleep: false } })
    await w.find('.extbtn').trigger('click')
    expect(w.emitted('extensions')).toHaveLength(1)
    expect(mount(TopBar, { props: { account: acc, asleep: true } }).find('.extbtn').exists()).toBe(false)
  })
})
