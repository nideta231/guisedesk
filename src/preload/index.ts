// App UI bridge.
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { countsAsInput } from './touch'
import { parseHint, pickPostLink } from './postlink'
import { blurCss, parseBlurHint, watchBlur, type Part } from './blur'
import { parseDragHint, watchDragScroll } from './dragscroll'
import { parseWakeepHint, wakeepScript } from './wakeep'

// Service views (flagged by main with --gd-service) get only a notification shim; the app bridge is not exposed to them.
const service = process.argv.includes('--gd-service')

/** Registers a listener and returns the function that removes it again, so a component can clean up on unmount. */
function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** Runs in the page's main world: replaces window.Notification and the page-side showNotification. */
const SHIM = `(() => {
  const send = window.__gdNotify
  delete window.__gdNotify
  const fire = (title, o) => { try { send(String(title), String((o && o.body) || ''), String((o && o.icon) || '')) } catch (e) {} }
  class N extends EventTarget {
    constructor(title, o) { super(); this.title = String(title); this.body = (o && o.body) || ''; this.onclick = null; fire(title, o) }
    close() {}
    static get permission() { return 'granted' }
    static requestPermission(cb) { if (cb) cb('granted'); return Promise.resolve('granted') }
  }
  Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true })
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, o) { fire(title, o); return Promise.resolve() }
  }
})()`

// Mouse and wheel input counts as activity for the idle lock (keys are seen by main's before-input-event).
// Runs in the app window and in service views; throttled to one message a second.
let lastTouch = 0
const touch = (e: Event) => {
  if (!countsAsInput(e)) return
  const t = Date.now()
  if (t - lastTouch < 1000) return
  lastTouch = t
  ipcRenderer.send('idle:touch')
}
for (const ev of ['mousemove', 'mousedown', 'wheel', 'touchstart']) window.addEventListener(ev, touch, { capture: true, passive: true })

if (service) {
  contextBridge.exposeInMainWorld('__gdNotify', (title: string, body: string, icon: string) =>
    ipcRenderer.send('notify:show', { title, body, icon })
  )
  webFrame.executeJavaScript(SHIM).catch(() => {})
  // D38: a middle-click on a JS-routed post (not inside a real <a>) asks main for a popup of its permalink.
  const hint = parseHint(process.argv)
  if (hint) {
    // D46: main asks for the post under the cursor when the context menu opens.
    ipcRenderer.on('post:at', (_e, id: number, x: number, y: number) => {
      const t = document.elementFromPoint(x, y)
      ipcRenderer.send('post:at-result', id, t ? pickPostLink(t, hint) : null)
    })
    window.addEventListener('auxclick', (e) => {
      const t = e.target
      if (e.button !== 1 || !(t instanceof Element) || t.closest('a')) return
      const url = pickPostLink(t, hint)
      if (!url) return
      e.preventDefault()
      ipcRenderer.send('popup:request', url)
    }, true)
  }
  // D44: drag to scroll sideways media rows (X).
  if (parseDragHint(process.argv)) {
    window.addEventListener('DOMContentLoaded', () => watchDragScroll(window, (e) => {
      const s = getComputedStyle(e)
      return { overflowX: s.overflowX, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }
    }), { once: true })
  }
  // D47b: keep deleted messages. The service supports it (--gd-wakeep); main says whether this account switched it on.
  // The script goes into the page only when on; toggling reloads the view, so off means nothing injected.
  if (parseWakeepHint(process.argv)) {
    ipcRenderer.invoke('wakeep:enabled').then((on) => {
      if (!on) return
      contextBridge.exposeInMainWorld('__gdWakeep', (s: string) => ipcRenderer.send('wakeep:state', s))
      webFrame.executeJavaScript(wakeepScript()).catch((e) => console.warn('[guisedesk] keeper failed', e))
    }).catch((e) => console.warn('[guisedesk] keeper state failed', e))
  }
  // D42/D43: blur media until hovered. Main owns the flag (blur:state at start, blur:set live).
  const blur = parseBlurHint(process.argv)
  if (blur) {
    let key: string | null = null
    let watcher: { stop: () => void; setParts: (p: readonly Part[]) => void } | null = null
    let parts: Part[] = ['messages', 'previews', 'avatars', 'names']
    let want = false
    // webFrame.insertCSS needs a document: wait for it and retry, and say so when it still fails.
    const insert = async (): Promise<string | null> => {
      for (let i = 0; i < 5; i++) {
        try { return await webFrame.insertCSS(blurCss(blur.strength)) } catch (e) {
          if (i === 4) console.warn('[guisedesk] blur css failed', e)
          else await new Promise((r) => setTimeout(r, 200 * (i + 1)))
        }
      }
      return null
    }
    const apply = async (next: boolean) => {
      want = next
      if (want && watcher) watcher.setParts(parts)
      if (want && !watcher) {
        if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }))
        if (!want || watcher) return
        watcher = watchBlur(window, blur, parts)
        if (key === null) { const k = await insert(); if (want) key = k; else if (k) webFrame.removeInsertedCSS(k) }
      } else if (!want) {
        watcher?.stop()
        watcher = null
        if (key !== null) { const k = key; key = null; webFrame.removeInsertedCSS(k) }
      }
    }
    const take = (s: { on?: boolean; parts?: Part[] }) => { if (Array.isArray(s?.parts)) parts = s.parts; return apply(!!s?.on) }
    ipcRenderer.invoke('blur:state').then(take).catch((e) => console.warn('[guisedesk] blur state failed', e))
    ipcRenderer.on('blur:set', (_e, s) => void take(s))
  }
} else contextBridge.exposeInMainWorld('guisedesk', {
  lockState: () => ipcRenderer.invoke('lock:state'),
  onLock: (cb: (info: unknown) => void) => listen('lock:changed', cb),
  unlock: (entry: string) => ipcRenderer.invoke('lock:unlock', entry),
  setupLock: (kind: string, secret: string, repeat: string) => ipcRenderer.invoke('lock:setup', kind, secret, repeat),
  lock: () => ipcRenderer.send('lock:lock'),
  prefs: () => ipcRenderer.invoke('prefs:get'),
  setIdle: (minutes: unknown) => ipcRenderer.invoke('prefs:idle', minutes),
  schedule: () => ipcRenderer.invoke('prefs:schedule-get'),
  setSchedule: (s: unknown) => ipcRenderer.invoke('prefs:schedule', s),
  lockCountdown: () => ipcRenderer.invoke('lock:countdown'),
  onLockCountdown: (cb: (c: { ms: number; rule: string } | null) => void) =>
    listen('lock:countdown', cb),
  lockMenu: () => ipcRenderer.send('lock:menu'),
  setDnd: (on: boolean) => ipcRenderer.invoke('prefs:dnd', on),
  onDnd: (cb: (on: boolean) => void) => listen('prefs:dnd-changed', cb),
  setQuietWorkHours: (on: boolean) => ipcRenderer.invoke('prefs:quiet-work-hours', on),
  setStartOnLogin: (on: boolean) => ipcRenderer.invoke('prefs:autostart', on),
  changeLock: (current: string, kind: string, secret: string, repeat: string) => ipcRenderer.invoke('lock:change', current, kind, secret, repeat),
  reset: (typed: string) => ipcRenderer.invoke('lock:reset', typed),
  state: () => ipcRenderer.invoke('accounts:state'),
  unread: () => ipcRenderer.invoke('unread:get'),
  onUnread: (cb: (counts: Record<string, number>) => void) =>
    listen('unread:update', cb),
  inbox: () => ipcRenderer.invoke('inbox:get'),
  inboxRead: (id: string) => ipcRenderer.invoke('inbox:read', id),
  inboxReadAll: () => ipcRenderer.invoke('inbox:read-all'),
  inboxClear: () => ipcRenderer.invoke('inbox:clear'),
  onInbox: (cb: (s: unknown) => void) => listen('inbox:update', cb),
  sleep: () => ipcRenderer.invoke('sleep:get'),
  onSleep: (cb: (s: unknown) => void) => listen('sleep:update', cb),
  setSidebar: (collapsed: boolean) => ipcRenderer.send('sidebar:set', collapsed),
  onSidebar: (cb: (collapsed: boolean) => void) => listen('sidebar:changed', cb),
  setSidebarHidden: (hidden: boolean) => ipcRenderer.send('sidebar:hidden', hidden),
  setSidebarWidth: (width: number) => ipcRenderer.send('sidebar:width', width),
  onSidebarLayout: (cb: (l: { collapsed: boolean; hidden: boolean; width: number }) => void) => listen('sidebar:layout', cb),
  splitMenu: (id: string) => ipcRenderer.send('split:menu', id),
  closeSplit: () => ipcRenderer.send('split:close'),
  setSplitRatio: (ratio: number) => ipcRenderer.send('split:ratio', ratio),
  saveSplitRatio: (ratio: number) => ipcRenderer.send('split:ratio-end', ratio),
  onSplit: (cb: (s: { b: string; ratio: number } | undefined) => void) => listen('split:changed', cb),
  select: (id: string) => ipcRenderer.send('accounts:select', id),
  onSwitcher: (cb: () => void) => listen('ui:switcher', cb),
  onShortcuts: (cb: () => void) => listen('ui:help', cb),
  dialog: (open: boolean) => ipcRenderer.send('ui:dialog', open),
  reload: (id: string) => ipcRenderer.send('accounts:reload', id),
  sleepNow: (id: string) => ipcRenderer.send('accounts:sleep', id),
  rowMenu: (id: string) => ipcRenderer.send('sidebar:menu', id),
  onRowMenuPick: (cb: (p: { id: string; action: string }) => void) => listen('sidebar:menu-pick', cb),
  reorder: (ids: string[]) => ipcRenderer.invoke('accounts:reorder', ids),
  resetZoom: (id: string) => ipcRenderer.invoke('accounts:zoom-reset', id),
  onZoom: (cb: (s: unknown) => void) => listen('accounts:zoom', cb),
  mute: (id: string, muted: boolean) => ipcRenderer.invoke('accounts:mute', id, muted),
  setProxy: (id: string, value: string) => ipcRenderer.invoke('accounts:proxy', id, value),
  proxyMenu: (id: string) => ipcRenderer.send('proxy:menu', id),
  testProxy: (id: string) => ipcRenderer.invoke('proxy:test', id),
  onOpenSheet: (cb: (id: string) => void) => listen('ui:sheet', cb),
  setBlur: (id: string, on: boolean) => ipcRenderer.invoke('accounts:blur', id, on),
  setBlurPart: (id: string, part: string, on: boolean) => ipcRenderer.invoke('accounts:blurpart', id, part, on),
  setKeepDeleted: (id: string, on: boolean) => ipcRenderer.invoke('accounts:keepdeleted', id, on),
  setExtension: (id: string, extId: string, on: boolean) => ipcRenderer.invoke('accounts:extension', id, extId, on),
  extensions: () => ipcRenderer.invoke('ext:list'),
  checkExtensionUpdates: () => ipcRenderer.invoke('ext:update-check'),
  installExtension: (link: string) => ipcRenderer.invoke('ext:install', link),
  removeExtension: (id: string) => ipcRenderer.invoke('ext:remove', id),
  extensionMenu: (id: string) => ipcRenderer.send('ext:menu', id),
  onOpenSettings: (cb: () => void) => listen('settings:open', cb),
  setServiceEnabled: (serviceId: string, enabled: boolean) => ipcRenderer.invoke('services:set', serviceId, enabled),
  setPolicy: (id: string, policy: string) => ipcRenderer.invoke('accounts:policy', id, policy),
  logout: (id: string) => ipcRenderer.invoke('accounts:logout', id),
  remove: (id: string) => ipcRenderer.invoke('accounts:remove', id),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateApply: () => ipcRenderer.invoke('update:apply'),
  onUpdate: (cb: (u: unknown) => void) => listen('update:changed', cb),
  exportBackup: (v: { password: string; includeLogins: boolean }) => ipcRenderer.invoke('backup:export', v),
  pickBackup: () => ipcRenderer.invoke('backup:pick'),
  inspectBackup: (v: { file: string; password: string }) => ipcRenderer.invoke('backup:inspect', v),
  restoreBackup: (v: { file: string; password: string }) => ipcRenderer.invoke('backup:restore', v),
  downloads: () => ipcRenderer.invoke('downloads:get'),
  setDownloadsAsk: (ask: boolean) => ipcRenderer.invoke('downloads:set', { ask }),
  pickDownloadsDir: () => ipcRenderer.invoke('downloads:pick'),
  blocking: () => ipcRenderer.invoke('blocking:get'),
  setBlocking: (v: { ads?: boolean; popups?: boolean }) => ipcRenderer.invoke('blocking:set', v),
  blockState: () => ipcRenderer.invoke('block:state'),
  onBlock: (cb: (s: unknown) => void) => listen('block:update', cb),
  openBlockedPopup: (id: string) => ipcRenderer.invoke('block:open-popup', id),
  shieldMenu: (id: string) => ipcRenderer.send('block:menu', id),
  onOpenSettingsTab: (cb: (tab: string) => void) => listen('settings:open-tab', cb),
  add: (input: unknown) => ipcRenderer.invoke('accounts:add', input),
  onLinkChoose: (cb: (r: unknown) => void) => listen('links:choose', cb),
  chooseLink: (id: number, choice: string | null) => ipcRenderer.send('links:chosen', id, choice),
  onSelected: (cb: (id: string) => void) => listen('accounts:selected', cb)
})
