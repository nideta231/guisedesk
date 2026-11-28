// Keep deleted WhatsApp messages (D47b). Plain TS, no electron. Everything the page needs is also shipped as one
// string (wakeepScript) that runs in the page's main world, so the functions listed in PAGE_FUNCTIONS must stay
// self-contained: they may call each other, but never anything at module level.

/** One cached message. t is in ms; `revoked` is the time we saw it deleted for everyone. */
export interface Entry {
  id: string
  chat: string
  from: string
  author?: string
  t: number
  type: string
  text: string
  caption: string
  thumb?: string
  revoked?: number
}

/** Where entries live: IndexedDB in the page, a Map in tests. */
export interface KeepStore {
  all(): Promise<Entry[]>
  put(e: Entry): Promise<void>
  remove(ids: string[]): Promise<void>
  /** Releases a connection that is kept open between operations (IndexedDB). */
  close?: () => void
}

export interface KeeperDeps {
  findStore: () => any
  store: KeepStore
  now: () => number
  doc: Document
  onState: (s: 'ok' | 'unavailable') => void
  /** How often and how many times to look for the store (WhatsApp loads its modules late). */
  tries: number
  delayMs: number
}

/** Reads main's `--gd-wakeep` argument (the service supports the keeper; main's wakeep:state says whether it is on). */
export function parseWakeepHint(argv: string[]): boolean {
  return argv.includes('--gd-wakeep')
}

function pick(m: any, k: string): any {
  if (!m) return undefined
  if (m[k] !== undefined) return m[k]
  return typeof m.get === 'function' ? m.get(k) : undefined
}

function ser(x: any): string {
  if (x === undefined || x === null) return ''
  if (typeof x === 'object') return String(x._serialized || (x.user ? x.user + '@' + (x.server || 'c.us') : ''))
  return String(x)
}

function msgId(m: any): string {
  return ser(pick(m, 'id'))
}

/** True once the message turned into "deleted for everyone". */
export function isRevoked(m: any): boolean {
  return pick(m, 'type') === 'revoked'
}

/** The cache entry for an incoming message with content, else null (own messages, system notices, revoked). */
export function snapshot(m: any): Entry | null {
  const id = msgId(m)
  const idObj = pick(m, 'id')
  if (!id || (idObj && typeof idObj === 'object' && idObj.fromMe)) return null
  const type = String(pick(m, 'type') || '')
  const body = pick(m, 'body')
  const caption = typeof pick(m, 'caption') === 'string' ? (pick(m, 'caption') as string) : ''
  let text: string
  let thumb: string | undefined
  if (type === 'chat') text = typeof body === 'string' ? body : ''
  else if (type === 'image' || type === 'video') {
    text = type === 'image' ? '[photo]' : '[video]'
    if (typeof body === 'string' && body.length > 0 && body.length < 30000 && /^[A-Za-z0-9+/=]+$/.test(body)) thumb = 'data:image/jpeg;base64,' + body
  } else if (type === 'document') text = String(pick(m, 'filename') || '[document]')
  else if (type === 'location') text = String(pick(m, 'loc') || '[location]')
  else if (type === 'sticker') text = '[sticker]'
  else if (type === 'ptt' || type === 'audio') text = '[voice message]'
  else return null
  const t = Number(pick(m, 't')) || 0
  const author = ser(pick(m, 'author'))
  return {
    id,
    chat: ser(idObj && idObj.remote) || ser(pick(m, 'from')),
    from: ser(pick(m, 'from')),
    ...(author ? { author } : {}),
    t: t * 1000,
    type,
    text,
    caption,
    ...(thumb ? { thumb } : {})
  }
}

/** Drops unrevoked entries older than 3 days and revoked ones older than 90 days (now in ms). */
export function prune(entries: Entry[], now: number): Entry[] {
  return entries.filter((e) => (e.revoked ? now - e.revoked < 90 * 86_400_000 : now - e.t < 3 * 86_400_000))
}

/** The text shown under the deleted bubble. */
export function noteFor(e: Entry): string {
  return [e.text, e.caption].filter(Boolean).join(' - ')
}

/** Appends one "Deleted message" block (text only, never HTML) to the row showing this entry's deleted bubble. */
export function renderDeleted(doc: Document, entry: Entry, rows?: Element[]): void {
  const list = rows || Array.prototype.slice.call(doc.querySelectorAll('[data-id]'))
  for (const row of list) {
    const did = row.getAttribute('data-id') || ''
    if (did.indexOf(entry.id) === -1 || row.querySelector('.gd-deleted')) continue
    const box = doc.createElement('div')
    box.className = 'gd-deleted'
    box.setAttribute('style', 'margin:4px 12px 6px;padding:6px 10px;border-left:3px solid #e0555a;border-radius:6px;background:rgba(224,85,90,.1);font-size:13px;line-height:1.35;opacity:.9;white-space:pre-wrap;word-break:break-word')
    const label = doc.createElement('strong')
    label.setAttribute('style', 'display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#e0555a')
    label.textContent = 'Deleted message'
    const body = doc.createElement('span')
    body.textContent = noteFor(entry)
    box.appendChild(label)
    box.appendChild(body)
    if (entry.thumb && entry.thumb.indexOf('data:image/jpeg;base64,') === 0) {
      const img = doc.createElement('img')
      img.setAttribute('src', entry.thumb)
      img.setAttribute('style', 'display:block;max-width:120px;max-height:120px;margin-top:4px;border-radius:4px')
      box.appendChild(img)
    }
    row.appendChild(box)
  }
}

/**
 * Finds WhatsApp Web's Msg collection. THIS DRIFTS WITH WHATSAPP RELEASES: when the keeper reports
 * "unavailable", fix this function (the module name, or the registry scan) and nothing else.
 */
export function findStore(win: any): any {
  const ok = (c: any) => c && typeof c.on === 'function' && typeof c.get === 'function' && c.models
  const req = win.require
  if (typeof req !== 'function') return null
  try {
    const c = req('WAWebCollections')
    if (c && ok(c.Msg)) return c.Msg
  } catch (e) { /* module name changed: fall through to the scan */ }
  try {
    const map = req.__debug && req.__debug.modulesMap
    if (map) {
      for (const k of Object.keys(map)) {
        const mod = map[k]
        const ex = mod && (mod.exports || (mod.publicModule && mod.publicModule.exports))
        const c = ex && (ex.Msg || (ex.default && ex.default.Msg))
        if (ok(c)) return c
      }
    }
  } catch (e) { /* scan failed */ }
  return null
}

/** The page's IndexedDB database `gd-wakeep` (per origin, so per account partition); one connection per keeper. */
export function idbStore(idb: IDBFactory): KeepStore {
  let db: IDBDatabase | null = null
  let opening: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening
    opening = new Promise((resolve, reject) => {
      const r = idb.open('gd-wakeep', 1)
      r.onupgradeneeded = () => void r.result.createObjectStore('msgs', { keyPath: 'id' })
      r.onsuccess = () => { db = r.result; resolve(r.result) }
      r.onerror = () => { opening = null; reject(r.error) }
    })
    return opening
  }
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> =>
    open().then(
      (conn) =>
        new Promise<T | undefined>((resolve, reject) => {
          const tx = conn.transaction('msgs', mode)
          const req = f(tx.objectStore('msgs'))
          tx.oncomplete = () => resolve(req ? req.result : undefined)
          tx.onerror = () => reject(tx.error)
        })
    )
  return {
    all: () => run<Entry[]>('readonly', (s) => s.getAll()).then((r) => r || []),
    put: (e) => run('readwrite', (s) => void s.put(e)).then(() => undefined),
    remove: (ids) => run('readwrite', (s) => void ids.forEach((i) => s.delete(i))).then(() => undefined),
    close: () => { db?.close(); db = null; opening = null }
  }
}

/**
 * Hooks the Msg collection: caches incoming messages, marks them when they are deleted for everyone, and renders the
 * kept text under the deleted bubble (also for rows that appear later). Returns null when the store is not found or
 * the hook throws: one console.warn and onState('unavailable'); WhatsApp is never touched in that case.
 */
export async function startKeeper(d: KeeperDeps): Promise<{ stop: () => void } | null> {
  const fail = (e: unknown) => {
    console.warn('[guisedesk] deleted-message keeper unavailable', e)
    d.onState('unavailable')
    return null
  }
  try {
    let coll = d.findStore()
    for (let i = 1; !coll && i < d.tries; i++) {
      await new Promise((r) => setTimeout(r, d.delayMs))
      coll = d.findStore()
    }
    if (!coll) return fail('Msg collection not found')
    const cache = new Map<string, Entry>()
    let revokedCount = 0
    const countRevoked = () => {
      revokedCount = 0
      for (const e of cache.values()) if (e.revoked) revokedCount++
    }
    const cleanup = async () => {
      const all = await d.store.all()
      const keep = prune(all, d.now())
      const keepIds = new Set(keep.map((e) => e.id))
      const drop = all.filter((e) => !keepIds.has(e.id)).map((e) => e.id)
      if (drop.length) await d.store.remove(drop)
      for (const id of drop) cache.delete(id)
      for (const e of keep) if (!cache.has(e.id)) cache.set(e.id, e)
      countRevoked()
    }
    await cleanup()
    const renderAll = () => {
      if (!revokedCount) return
      const rows: Element[] = Array.prototype.filter.call(d.doc.querySelectorAll('[data-id]'), (r: Element) => !r.querySelector('.gd-deleted'))
      if (!rows.length) return
      // One pass builds the lookup; a chat with many deleted messages is no longer revoked x rows.
      const index = new Map<string, Element[]>()
      for (const r of rows) {
        const key = r.getAttribute('data-id') || ''
        const hits = index.get(key)
        if (hits) hits.push(r)
        else index.set(key, [r])
      }
      const misses: Entry[] = []
      for (const e of cache.values()) {
        if (!e.revoked) continue
        const hits = index.get(e.id)
        if (hits) renderDeleted(d.doc, e, hits)
        else misses.push(e)
      }
      // Legacy rows whose data-id only contains the id (a prefix or suffix) still match, but only for entries
      // that found no exact row.
      for (const e of misses) renderDeleted(d.doc, e, rows)
    }
    const take = (m: any) => {
      try {
        const id = msgId(m)
        const have = cache.get(id)
        if (isRevoked(m)) {
          if (have && !have.revoked) {
            have.revoked = d.now()
            revokedCount++
            void d.store.put(have).catch(() => {})
          }
          if (have) renderAll()
          return
        }
        if (have) return
        const e = snapshot(m)
        if (!e) return
        cache.set(e.id, e)
        void d.store.put(e).catch(() => {})
      } catch (e) { /* one odd message must not stop the rest */ }
    }
    for (const m of coll.models) take(m)
    coll.on('add', take)
    coll.on('change:type', take)
    let pending: ReturnType<typeof setTimeout> | null = null
    const view = d.doc.defaultView
    const obs = view && new view.MutationObserver(() => {
      if (!revokedCount || pending) return
      pending = setTimeout(() => { pending = null; renderAll() }, 50)
    })
    // WhatsApp re-creates #main whenever the user opens another chat, so observe the stable document root and
    // let the revoked check (and the cheap early return above) skip the constant background mutations.
    if (obs) obs.observe(d.doc.documentElement, { childList: true, subtree: true })
    renderAll()
    const timer = setInterval(() => void cleanup().catch(() => {}), 3_600_000)
    d.onState('ok')
    return { stop: () => { clearInterval(timer); if (obs) obs.disconnect(); if (pending) clearTimeout(pending); d.store.close?.() } }
  } catch (e) {
    return fail(e)
  }
}

const PAGE_FUNCTIONS = [pick, ser, msgId, isRevoked, snapshot, prune, noteFor, renderDeleted, findStore, idbStore, startKeeper]

/** The main-world script: expression that starts the keeper. main-world gets window.__gdWakeep (a send fn) once. */
export function wakeepScript(): string {
  return `(() => {
${PAGE_FUNCTIONS.map((f) => f.toString()).join('\n')}
  const send = window.__gdWakeep
  delete window.__gdWakeep
  const report = (s) => { try { send(s) } catch (e) {} }
  let store
  try { store = idbStore(window.indexedDB) } catch (e) { console.warn('[guisedesk] deleted-message keeper unavailable', e); report('unavailable'); return }
  startKeeper({ findStore: () => findStore(window), store, now: () => Date.now(), doc: document, onState: report, tries: 60, delayMs: 1000 })
})()`
}
