// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import AccountSheet from '../src/renderer/src/AccountSheet.vue'
import { addAccount, loadAccounts, setKeepDeleted } from '../src/main/accounts'
import { PRESETS } from '../src/main/presets'
import { isRevoked, noteFor, parseWakeepHint, prune, renderDeleted, snapshot, startKeeper, wakeepScript, type Entry, type KeepStore } from '../src/preload/wakeep'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

const model = (o: Record<string, unknown> = {}) => ({
  id: { _serialized: 'false_111@c.us_3EB01', fromMe: false, remote: { _serialized: '111@c.us' } },
  type: 'chat', body: 'hello there', t: NOW / 1000, from: { _serialized: '111@c.us' }, author: undefined,
  ...o
})

class FakeColl {
  models: any[] = []
  h: Record<string, ((m: any) => void)[]> = {}
  on(ev: string, fn: (m: any) => void) { (this.h[ev] ||= []).push(fn) }
  get() { return undefined }
  add(m: any) { this.models.push(m); (this.h.add || []).forEach((f) => f(m)) }
  setType(m: any, type: string) { m.type = type; (this.h['change:type'] || []).forEach((f) => f(m)) }
}

const memStore = (init: Entry[] = []): KeepStore & { rows: Map<string, Entry> } => {
  const rows = new Map(init.map((e) => [e.id, e]))
  return {
    rows,
    all: async () => [...rows.values()],
    put: async (e) => void rows.set(e.id, { ...e }),
    remove: async (ids) => void ids.forEach((i) => rows.delete(i))
  }
}

const row = (id: string, text = 'This message was deleted') => {
  document.body.insertAdjacentHTML('beforeend', `<div id="main"><div data-id="${id}" class="row"><span>${text}</span></div></div>`)
  return document.querySelector(`[data-id="${id}"]`)!
}
const settle = () => new Promise((r) => setTimeout(r, 90))
const running: ({ stop: () => void } | null)[] = []
const start = async (coll: unknown, store: KeepStore, extra: Record<string, unknown> = {}) => {
  const k = await startKeeper({ findStore: () => coll, store, now: () => NOW, doc: document, onState: () => {}, tries: 2, delayMs: 1, ...extra } as any)
  running.push(k)
  return k
}

afterEach(() => { running.splice(0).forEach((k) => k?.stop()); document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('wakeep pure parts', () => {
  it('snapshot keeps content of incoming messages and skips the rest', () => {
    expect(snapshot(model())).toMatchObject({ id: 'false_111@c.us_3EB01', chat: '111@c.us', from: '111@c.us', t: NOW, type: 'chat', text: 'hello there' })
    expect(snapshot(model({ type: 'image', caption: 'sunset', body: '/9j/AAAA' }))).toMatchObject({ type: 'image', text: '[photo]', caption: 'sunset', thumb: 'data:image/jpeg;base64,/9j/AAAA' })
    expect(snapshot(model({ type: 'document', filename: 'cv.pdf', caption: 'my cv' }))).toMatchObject({ text: 'cv.pdf', caption: 'my cv' })
    expect(snapshot(model({ type: 'location', loc: 'Cafe Oma' }))?.text).toBe('Cafe Oma')
    expect(snapshot(model({ type: 'sticker', body: '' }))?.text).toBe('[sticker]')
    expect(snapshot(model({ type: 'ptt' }))?.text).toBe('[voice message]')
    expect(snapshot(model({ id: { _serialized: 'true_111@c.us_X', fromMe: true } }))).toBeNull()
    expect(snapshot(model({ type: 'e2e_notification' }))).toBeNull()
    expect(snapshot(model({ type: 'revoked' }))).toBeNull()
  })

  it('isRevoked and noteFor', () => {
    expect(isRevoked(model({ type: 'revoked' }))).toBe(true)
    expect(isRevoked(model())).toBe(false)
    expect(noteFor(snapshot(model())!)).toBe('hello there')
    expect(noteFor(snapshot(model({ type: 'image', caption: 'sunset' }))!)).toBe('[photo] - sunset')
    expect(noteFor(snapshot(model({ type: 'sticker' }))!)).toBe('[sticker]')
  })

  it('prune keeps unrevoked 3 days and revoked 90 days', () => {
    const e = (id: string, ageDays: number, revokedAgeDays?: number): Entry => ({
      id, chat: 'c', from: 'f', t: NOW - ageDays * DAY, type: 'chat', text: id, caption: '',
      ...(revokedAgeDays === undefined ? {} : { revoked: NOW - revokedAgeDays * DAY })
    })
    const kept = prune([e('new', 1), e('old', 4), e('rev-new', 80, 80), e('rev-old', 100, 91)], NOW).map((x) => x.id)
    expect(kept).toEqual(['new', 'rev-new'])
  })

  it('a hint argument and the script are well formed', () => {
    expect(parseWakeepHint(['--gd-service', '--gd-wakeep'])).toBe(true)
    expect(parseWakeepHint(['--gd-service'])).toBe(false)
    expect(() => new Function('return ' + wakeepScript())).not.toThrow()
  })
})

describe('renderDeleted', () => {
  it('appends one .gd-deleted block under the deleted row, idempotent, text only', () => {
    const r = row('false_111@c.us_3EB01_x')
    const entry = { ...snapshot(model({ body: '<img src=x onerror=alert(1)>' }))!, revoked: NOW }
    renderDeleted(document, entry)
    renderDeleted(document, entry)
    const blocks = r.querySelectorAll('.gd-deleted')
    expect(blocks.length).toBe(1)
    expect(blocks[0].textContent).toContain('Deleted message')
    expect(blocks[0].textContent).toContain('<img src=x onerror=alert(1)>')
    expect(r.querySelector('.gd-deleted img')).toBeNull()
    expect(r.querySelectorAll('img').length).toBe(0)
  })

  it('shows the thumbnail as an image element when cached', () => {
    const r = row('false_111@c.us_3EB01')
    renderDeleted(document, { ...snapshot(model({ type: 'image', body: '/9j/AAAA' }))!, revoked: NOW })
    expect(r.querySelector('.gd-deleted img')?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/AAAA')
  })
})

describe('startKeeper', () => {
  it('shows the original text under a message deleted for everyone; own messages are not cached', async () => {
    const coll = new FakeColl(), store = memStore()
    const k = await start(coll, store)
    const incoming = model(), mine = model({ id: { _serialized: 'true_111@c.us_M1', fromMe: true }, body: 'secret' })
    coll.add(incoming); coll.add(mine)
    await settle()
    expect([...store.rows.keys()]).toEqual(['false_111@c.us_3EB01'])
    const r = row('false_111@c.us_3EB01')
    coll.setType(incoming, 'revoked')
    await settle()
    expect(r.querySelector('.gd-deleted')?.textContent).toContain('hello there')
    expect(store.rows.get('false_111@c.us_3EB01')?.revoked).toBe(NOW)
    k?.stop()
  })

  it('keeps captions and media placeholders', async () => {
    const coll = new FakeColl(), store = memStore()
    await start(coll, store)
    const m = model({ type: 'image', caption: 'sunset', body: '' })
    coll.add(m)
    const r = row('false_111@c.us_3EB01')
    coll.setType(m, 'revoked')
    await settle()
    expect(r.querySelector('.gd-deleted')?.textContent).toContain('[photo] - sunset')
  })

  it('survives a restart: revoked entries render when the row appears later, and old ones are pruned', async () => {
    const old: Entry = { id: 'false_9@c.us_OLD', chat: 'c', from: 'f', t: NOW - 100 * DAY, type: 'chat', text: 'gone', caption: '', revoked: NOW - 95 * DAY }
    const kept: Entry = { id: 'false_111@c.us_3EB01', chat: 'c', from: 'f', t: NOW - 2 * DAY, type: 'chat', text: 'from before restart', caption: '', revoked: NOW - DAY }
    const store = memStore([old, kept])
    const k = await start(new FakeColl(), store)
    expect([...store.rows.keys()]).toEqual(['false_111@c.us_3EB01'])
    const r = row('false_111@c.us_3EB01')
    await settle()
    expect(r.querySelector('.gd-deleted')?.textContent).toContain('from before restart')
    k?.stop()
  })

  it('does not scan the chat on mutations until something was deleted, then it does', async () => {
    document.body.innerHTML = '<div id="main"></div>'
    const coll = new FakeColl(), store = memStore()
    await start(coll, store)
    const qsa = vi.spyOn(document, 'querySelectorAll')
    document.getElementById('main')!.appendChild(document.createElement('div'))
    await settle()
    expect(qsa).not.toHaveBeenCalled()
    const m = model()
    coll.add(m)
    document.getElementById('main')!.insertAdjacentHTML('beforeend', '<div data-id="false_111@c.us_3EB01"><span>x</span></div>')
    await settle()
    qsa.mockClear()
    coll.setType(m, 'revoked')
    await settle()
    expect(qsa).toHaveBeenCalled()
  })

  it('store not found: one warning, state unavailable, nothing thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const states: string[] = []
    const k = await start(null, memStore(), { onState: (s: string) => states.push(s) })
    expect(k).toBeNull()
    expect(states).toEqual(['unavailable'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a hook that throws is the same quiet failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const states: string[] = []
    const bad = { models: [], on() { throw new Error('boom') } }
    await start(bad, memStore(), { onState: (s: string) => states.push(s) })
    expect(states).toEqual(['unavailable'])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('keep deleted flag and sheet', () => {
  it('Account.keepDeleted is off by default and set per account; only WhatsApp has the preset flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-wk-'))
    const a = addAccount(dir, { serviceId: 'whatsapp', label: 'a', colour: '#6d5bd0' }), b = addAccount(dir, { serviceId: 'whatsapp', label: 'b', colour: '#6d5bd0' })
    expect(loadAccounts(dir).every((x) => !x.keepDeleted)).toBe(true)
    setKeepDeleted(dir, a.id, true)
    expect(loadAccounts(dir).find((x) => x.id === a.id)?.keepDeleted).toBe(true)
    expect(loadAccounts(dir).find((x) => x.id === b.id)?.keepDeleted).toBeFalsy()
    expect(PRESETS.filter((p) => p.keepDeleted).map((p) => p.id)).toEqual(['whatsapp'])
  })

  const acc = (serviceId: string, extra: Record<string, unknown> = {}) => ({ id: 'a1', serviceId, label: 'L', colour: '#6d5bd0', ...extra })
  it('the switch is WhatsApp only and emits the flipped value; the unavailable note shows', async () => {
    expect(mount(AccountSheet, { props: { account: acc('x') } }).find('[aria-label="Keep deleted messages"]').exists()).toBe(false)
    const w = mount(AccountSheet, { props: { account: acc('whatsapp') } })
    const t = w.find('[aria-label="Keep deleted messages"]')
    expect(t.attributes('aria-checked')).toBe('false')
    expect(w.text()).not.toContain('keeper unavailable')
    await t.trigger('click')
    expect(w.emitted('keepDeleted')![0]).toEqual([true])
    const down = mount(AccountSheet, { props: { account: acc('whatsapp', { keepDeleted: true, keeperUnavailable: true }) } })
    expect(down.text()).toContain('Deleted-message keeper unavailable (WhatsApp changed)')
  })
})
