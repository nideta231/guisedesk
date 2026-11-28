import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, nativeImage, powerMonitor, session, shell, WebContentsView } from 'electron'
import { appRoot, dataDir, devUnlocked } from './paths'
import { addAccount, IDLE_POLICIES, loadAccounts, loadDisabled, loadDnd, loadIdleMinutes, loadProxyAuth, loadQuietWorkHours, loadSchedule, loadSplit, saveProxyAuth, saveSchedule, saveSplit, saveQuietWorkHours, loadSelected, loadSidebarCollapsed, saveSidebarCollapsed, loadSidebarLayout, saveSidebarLayout, orderedAccounts, saveDnd, saveSelected, setAccountProxy, setIdlePolicy, reorderAccounts, setMuted, setBlurMedia, setBlurPart, setKeepDeleted, setExtensions, setServiceEnabled, setZoom, type Account, type SplitState } from './accounts'
import { logOut, removeAccount } from './accountops'
import { overlay } from './composite'
import { cacheFavicon, readIcon, type Fetcher } from './favicon'
import { validateNewAccount } from './validate'
import { presetFor, CHROME_UA } from './presets'
import { redirectAllowed, route } from './links'
import { candidatesFor, homesOf, pickTarget, safeWebUrl, siblingsFor } from './servicelinks'
import { acceptPopupRequest, createPopups, openTarget } from './popups'
import { blockedLine, isGesture, loadBlocking, popupBlocked, saveBlocking, type BlockingSettings } from './blocking'
import { createAdblock } from './adblock'
import { buildInWorker, loadEngineBytes, PRELOAD_PATH } from './adengine'
import { createBlockState, shieldMenuItems } from './blockstate'
import { createDispatcher } from './webrequest'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { downloadExtension } from 'electron-chrome-web-store'
import { actionClick, checkExtensionUpdates, createExtensionFetcher, enabledFor, extensionsDir, listInstalled, loadUpdateTimes, parseExtensionId, readManifest, saveUpdateTimes, toggled, type ExtensionUpdate } from './extensions'
import { appendEvent, LOGIN_COOKIES, lostLogins } from './events'
import { parseWaPage, readDirSafe, storeHasData, waStorePath, whatsappLoggedIn, WA_PAGE_SCRIPT, type WaPage } from './whatsapp'
import { writeAtomic } from './atomic'
import { normalizeSchedule, type LockSchedule } from './schedule'
import { parseUnread, totalUnread } from './unread'
import { createTray } from './tray'
import { decideNotification, quietOutsideWorkHours } from './notify'
import { applyPermissionPolicy } from './permissions'
import { createHibernator, launchAsleep, limitMinutes } from './hibernate'
import { createLock, isLockShortcut } from './lock'
import { appOnly, createGuardedIpc } from './guard'
import { wireTriggers } from './triggers'
import { resetData, RESET_WORD } from './reset'
import { isAutostart, setAutostart, startsHidden } from './autostart'
import { applyIdle } from './prefs'
import { checkForUpdate, realRun, type UpdateInfo } from './updater'
import { version } from '../../package.json'
import { buildContextMenu, rowMenuItems } from './contextmenu'
import { doneNotice, loadDownloads, saveDownloads, uniquePath } from './downloads'
import { isHelpShortcut, isSwitcherShortcut, nextZoom, switchTarget, zoomKey, type KeyInput } from './shortcuts'
import { sidebarOrder } from './services'
import { PARTS, partsOn, type Part } from '../preload/blur'
import { onPartition, partitionKey, partitionOf } from './sharing'
import { effectiveProxy, findProxyCredential, parseProxy, proxyLabel, proxyMenu, proxyRules, sameProxy, proxyHostOf } from './proxy'
import { secondLaunch } from './singleinstance'
import { clampSide, clampSplit, isSidebarShortcut, panelBounds as layoutBounds, splitBounds } from './layout'
import { applyPendingRestore } from './backup'
import { backupFileName } from './backuprules'
import { runBackupWorker } from './backupengine'
import { addInbox, inboxItem, markAllRead, markRead, unreadCount, type InboxItem } from './inbox'
import { loadInbox, saveInbox } from './inboxstore'

// Both must run before `ready`. setName first: it resets the default userData path, which setPath then overrides,
// so sessions and partitions still land in the chosen dir. The name is what notifications and the tray show.
app.setName('GuiseDesk')
app.setDesktopName('guisedesk.desktop')
const dir = dataDir(process.env, homedir())
mkdirSync(dir, { recursive: true })
app.setPath('userData', dir)
// One copy per data dir (D35): the lock follows userData, so dev and test dirs get their own. A second copy exits here,
// before the lock file, the session or any window is touched.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// A restore staged before the last quit (D61) is applied now, before the lock, any session or any window exists.
// The encrypted backup is unpacked into a pending file at confirm time, so no password is stored across restarts.
let restoredExtensions: string[] = []
try {
  const restored = applyPendingRestore(dir)
  if (restored) {
    restoredExtensions = restored.extensions
    appendEvent(dir, `restored backup (${restored.accounts} accounts, ${restored.extensions.length} extensions${restored.includeLogins ? ', with logins' : ''})`)
  }
} catch (err) {
  appendEvent(dir, `restore failed ${String((err as Error)?.message ?? err)}`)
}

// Content panel inside the renderer layout (D26 compact): numbers in layout.ts, shared with Sidebar.vue.
// Sidebar rail state (D24), loaded from settings in createWindow.
let sidebarCollapsed = false
// Drag width and fully hidden sidebar (D52).
let sidebarWidth = 232
let sidebarHidden = false
function panelBounds(win: BrowserWindow) {
  const [w, h] = win.getContentSize()
  return layoutBounds(w, h, sidebarCollapsed, sidebarWidth, sidebarHidden)
}
// The account page's corners match the rounded inset panel (10px in tokens.css).
const VIEW_RADIUS = 10

// App lock (D9): main is the source of truth. Locked or in setup, no account data goes to the renderer and no service view
// is on the window. GUISEDESK_DEV_UNLOCKED=1 (dev only, honoured only with GUISEDESK_DATA plus GUISEDESK_DEV or GUISEDESK_SHOT, never for ~/.config/GuiseDesk) skips the lock for screenshot runs.
const lock = createLock({ dir, startUnlocked: devUnlocked(process.env, dir, homedir()) })
const isUnlocked = () => lock.state() === 'unlocked'
// Every channel that returns or acts on account data is registered through this: it refuses while locked.
const gipc = createGuardedIpc(ipcMain, isUnlocked)

// No application menu (its default has Reload and DevTools); DevTools only in dev runs.
Menu.setApplicationMenu(null)
const devTools = process.env.GUISEDESK_DEV === '1'

const views = new Map<string, WebContentsView>()
let attached: WebContentsView | undefined
// Split view (D62): the selected account stays `attached`; `second` is the side-by-side account.
let second: WebContentsView | undefined
let splitB: string | undefined
let splitRatio = 0.5
// The service view that last had focus: zoom keys act on it while split is on, otherwise on the selected one.
let focusedId: string | undefined
let onSplitChange: () => void = () => {}
// While a dialog is open the service view is detached (it would draw over the dialog).
let dialogOpen = false
// Unread count per account id, from page titles. GUISEDESK_FAKE_COUNTS="id=3,id2=12" (dev only) pins them instead.
const counts: Record<string, number> = {}
const fakeCounts = process.env.GUISEDESK_FAKE_COUNTS
let onCounts: () => void = () => {}
let quitting = false
// Global Do Not Disturb (D19), loaded from settings in createWindow.
let dnd = false
// Quiet outside work hours (D58): notifications are dropped outside the lock schedule's days/hours. Separate from dnd.
let quietWork = false
let quietSchedule: LockSchedule = normalizeSchedule(undefined)
// Services switched off in Settings (D6): hidden from the sidebar, no notifications, sessions kept.
let disabled = new Set<string>()
// Which account a service view's webContents belongs to, for notification IPC.
const owner = new Map<number, Account>()
/** What the service preload needs for the blur: the main switch and the enabled parts (D48). */
const blurState = (a?: Account) => ({ on: !!a?.blurMedia, parts: partsOn(a?.blurParts) })
// Hibernation (D7): sleep = view destroyed, partition kept. sleepState feeds the sidebar (ZZ) and the asleep panel.
const hib = createHibernator(Date.now)
const sleepState: Record<string, { minutes: number; waking: boolean }> = {}
let attachedId: string | undefined
// Input anywhere in the app (window or a service view) restarts the idle period; set once the triggers are wired.
let touchIdle: () => void = () => {}
let toggleSidebar: () => void = () => {}
// Zoom keys (D32): true when the key was a zoom key (swallowed), whether or not a view was there to zoom.
let zoomKeyDown: (i: KeyInput) => boolean = () => false
// Ctrl+1..9 / Ctrl+Tab (D33): true when the key switched the account.
let switchKeyDown: (i: KeyInput) => boolean = () => false
// Ctrl+K (D59): ask the renderer to open the quick switcher over everything, service views included.
let openSwitcher: () => void = () => {}
// F1 (D60): ask the renderer to show the shortcut cheat sheet.
let openHelp: () => void = () => {}
const live = new Set<Notification>() // keep references so click handlers survive GC
// Notifications inbox (D64): kept in memory and inbox.json; muted items stay but are not counted.
let inbox: InboxItem[] = []
let onInbox: () => void = () => {}

/** One request to the site for its favicon (Custom URL accounts only, once per host). */
const fetchSite: Fetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!r.ok) return null
  const bytes = new Uint8Array(await r.arrayBuffer())
  return bytes.length > 512 * 1024 ? null : { contentType: r.headers.get('content-type') ?? '', bytes }
}

// Popup windows (D37): middle-click / Ctrl+click on a same-service link. Closed on lock, logout, remove and sleep.
const popups = createPopups<BrowserWindow>((w) => {
  if (!w.isDestroyed()) w.close()
})

// An external link (D40): set in createWindow, which owns the account list and the window. Default: the browser.
let openOut: (url: string) => void = (url) => void shell.openExternal(url)
// Open in another account (D46): set in createWindow too. siblingsOf lists the other-partition accounts of the service.
let siblingsOf: (a: Account) => Account[] = () => []
let openIn: (url: string, c: Account[]) => void = () => {}
// Post under the cursor (D46): main asks the service preload, which answers on 'post:at-result'.
const postWaiters = new Map<number, (url: string | null) => void>()
let postSeq = 0
function postAt(wc: Electron.WebContents, x: number, y: number): Promise<string | null> {
  if (!presetFor(owner.get(wc.id)?.serviceId ?? '')?.postLink) return Promise.resolve(null)
  return new Promise((resolve) => {
    const id = ++postSeq
    const done = (u: string | null) => {
      clearTimeout(t)
      postWaiters.delete(id)
      resolve(u)
    }
    const t = setTimeout(() => done(null), 150)
    postWaiters.set(id, done)
    wc.send('post:at', id, x, y)
  })
}

// Ad and pop-up blocking (D45): read once, changed from Settings > General. Sessions seen so far get the ad blocker.
let blocking: BlockingSettings = loadBlocking(dir)
// Top bar chips: blocked count per account, last dropped pop-up. onBlockChange is set in createWindow (it owns the window).
let onBlockChange: () => void = () => {}
const blockState = createBlockState(() => onBlockChange())
// webContents id -> account id, for service views and their popups (the blocked count and the pop-up chip).
const wcAccount = new Map<number, string>()
const adblock = createAdblock({
  dir,
  build: buildInWorker,
  load: loadEngineBytes,
  handle: (ch, fn) => ipcMain.handle(ch, fn),
  preloadPath: PRELOAD_PATH,
  wanted: () => blocking.ads,
  onBlocked: (wcId, url) => {
    const id = wcAccount.get(wcId)
    if (id) blockState.blocked(id, url)
  }
})
// One webRequest dispatcher per session: features add named handlers, removing one never clears another.
const dispatchers = new WeakMap<Electron.Session, ReturnType<typeof createDispatcher>>()
const dispatcherFor = (ses: Electron.Session) => {
  let d = dispatchers.get(ses)
  if (!d) dispatchers.set(ses, (d = createDispatcher(ses.webRequest as never)))
  return d
}
const blockSessions = new Set<Electron.Session>()
function hookBlocking(ses: Electron.Session): void {
  blockSessions.add(ses)
  void adblock.setSession(ses, dispatcherFor(ses), blocking.ads)
}
// Last click, tap or key press per webContents, for the pop-up rule. Also tags the webContents with its account and
// resets the account's chips on each main-frame navigation.
const lastGesture = new Map<number, number>()
function trackGestures(wc: Electron.WebContents, accountId: string, isView: boolean): void {
  const id = wc.id
  wcAccount.set(id, accountId)
  wc.on('input-event', (_e, i) => {
    if (isGesture(i.type)) lastGesture.set(id, Date.now())
  })
  if (isView) wc.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) blockState.navigated(accountId)
  })
  wc.once('destroyed', () => {
    lastGesture.delete(id)
    wcAccount.delete(id)
  })
}
/**
 * The pop-up rule (D45, D37 amendment): a window the page opened with no click or key in the last 5 s, or an ad
 * click-through page, is dropped, logged and offered in the top bar ("Pop-up blocked", open anyway).
 * Middle-click / Ctrl+click on a link (disposition background-tab) and sign-in pages are always allowed.
 */
function blockedPopup(wc: Electron.WebContents, accountId: string, url: string, disposition?: string): boolean {
  if (!blocking.popups) return false
  const now = Date.now()
  const last = lastGesture.get(wc.id)
  const dropped =
    popupBlocked({ on: true, now, lastGesture: last, disposition, url }) ||
    (blocking.ads && disposition !== 'background-tab' && adblock.isAdPopup(url, wc.getURL()))
  if (!dropped) return false
  console.warn(blockedLine(url, now, last))
  blockState.popup(accountId, url)
  return true
}

/** Link rules (D8) shared by a service view and its popups: in-app stays, external goes to the browser, redirects are checked. */
function hookNav(wc: Electron.WebContents, a: Account): (url: string) => boolean {
  const go = (url: string): boolean => {
    const r = route(url, a)
    if (r.action === 'in-app') {
      if (r.url !== url) wc.loadURL(r.url)
      return r.url === url
    }
    if (r.action === 'external') openOut(r.url)
    return false
  }
  wc.on('will-navigate', (e, url) => {
    if (!go(url)) e.preventDefault()
  })
  wc.on('will-redirect', (e, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return
    const d = redirectAllowed(url, a)
    if (d.allow) return
    e.preventDefault()
    if (d.open) openOut(d.open)
    if (d.load) wc.loadURL(d.load)
  })
  return go
}

/** A normal window on the account's session, no app preload (D37). A same-service window.open inside it loads in itself. */
function openPopup(a: Account, url: string): void {
  const target = safeWebUrl(url)
  if (!target) return
  const w = new BrowserWindow({
    width: 1000,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#15151c',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { partition: partitionOf(a), sandbox: true, contextIsolation: true, devTools }
  })
  w.removeMenu()
  const wc = w.webContents
  wc.setUserAgent(presetFor(a.serviceId)?.userAgent ?? CHROME_UA)
  const go = hookNav(wc, a)
  trackGestures(wc, a.id, false)
  hookBlocking(wc.session)
  applyPermissionPolicy(wc.session)
  wc.setWindowOpenHandler(({ url: u, disposition }) => {
    if (blockedPopup(wc, a.id, u, disposition)) return { action: 'deny' }
    const r = route(u, a)
    if (r.action === 'in-app') wc.loadURL(r.url)
    else go(u)
    return { action: 'deny' }
  })
  hookContextMenu(wc)
  wc.setZoomLevel(a.zoom ?? 0)
  wc.on('dom-ready', () => wc.setZoomLevel(a.zoom ?? 0))
  wc.on('page-title-updated', (_e, title) => w.setTitle(title))
  wc.on('before-input-event', (e, input) => {
    hib.touch(a.id)
    touchIdle()
    if (input.type !== 'keyDown') return
    // Ctrl+K (D59) opens the quick switcher in the main window.
    if (isSwitcherShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openSwitcher()
      return
    }
    // F1 (D60) shows the shortcut cheat sheet.
    if (isHelpShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openHelp()
      return
    }
    // Ctrl+L locks from a popup too; locking closes every popup (D37).
    if (isLockShortcut(input)) {
      e.preventDefault()
      lock.lock()
      return
    }
    if (input.key === 'Escape' || (input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'w')) {
      e.preventDefault()
      w.close()
    }
  })
  popups.add(a.id, w)
  w.on('closed', () => popups.forget(w))
  // A popup follows its account's session proxy too (D63).
  void configureProxy(wc.session, proxyFor(a)).then(() => {
    if (!wc.isDestroyed()) wc.loadURL(target)
  })
}

/** Where a window.open from a service view goes (D8, D37): popup, same view, the browser, or nowhere. */
function openFromView(wc: Electron.WebContents, a: Account, url: string, disposition: string): void {
  const r = route(url, a)
  const target = openTarget(disposition, r.action)
  if (target === 'popup') openPopup(a, r.url)
  else if (target === 'same-view') wc.loadURL(r.url)
  else if (target === 'external') openOut(r.url)
}

/** Link policy (D8): in-app loads in this view; a tab-style open (D37) gets a popup; mailto goes out; the rest is denied or external. */
function hookLinks(v: WebContentsView, a: Account): void {
  const wc = v.webContents
  hookNav(wc, a)
  trackGestures(wc, a.id, true)
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (blockedPopup(wc, a.id, url, disposition)) return { action: 'deny' }
    openFromView(wc, a, url, disposition)
    return { action: 'deny' }
  })
  // Split view (D62): zoom keys act on the page that was clicked into.
  wc.on('focus', () => {
    focusedId = a.id
  })
  wc.on('before-input-event', (e, input) => {
    hib.touch(a.id)
    touchIdle()
    focusedId = a.id
    // Ctrl+B toggles the sidebar, but never while locked (the view is off the window then anyway).
    if (isSidebarShortcut(input) && isUnlocked()) {
      e.preventDefault()
      toggleSidebar()
      return
    }
    // Ctrl+K (D59): the page never sees it; the renderer opens the quick switcher and detaches this view.
    if (isSwitcherShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openSwitcher()
      return
    }
    // F1 (D60): the shortcut cheat sheet, over the detached view.
    if (isHelpShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openHelp()
      return
    }
    if (zoomKeyDown(input) || switchKeyDown(input)) {
      e.preventDefault()
      return
    }
    // Ctrl+L locks even while focus is inside a service page (the page never sees the key).
    if (isLockShortcut(input)) {
      e.preventDefault()
      lock.lock()
    }
  })
  wc.on('page-title-updated', (_e, title) => {
    if (fakeCounts) return
    counts[a.id] = parseUnread(title, presetFor(a.serviceId))
    onCounts()
  })
}

/** Right-click menu (D30): the template builder gives action ids; they map to webContents, clipboard and shell calls here. */
function hookContextMenu(wc: Electron.WebContents): void {
  wc.on('context-menu', async (_e, p) => {
    const nav = wc.navigationHistory
    // Service views only (owner map), not popups or the app UI (D46).
    const me = owner.get(wc.id)
    const sibs = me && isUnlocked() ? siblingsOf(me) : []
    const post = sibs.length && !(p.linkURL && pickTarget(p.linkURL, null, '', homesOf(me!))) ? await postAt(wc, p.x / wc.getZoomFactor(), p.y / wc.getZoomFactor()) : null
    const items = buildContextMenu(p, { canGoBack: nav.canGoBack(), canGoForward: nav.canGoForward(), locked: !isUnlocked(), siblings: sibs.length })
    if (!items.length) return
    const run = (action: string, value?: string) => {
      switch (action) {
        case 'open-link':
          if (/^https?:\/\//i.test(p.linkURL)) void shell.openExternal(p.linkURL)
          break
        case 'open-in-other': {
          // The page controls this URL; only a web one may load in another account's session.
          const target = me ? safeWebUrl(pickTarget(p.linkURL, post, wc.getURL(), homesOf(me))) : null
          if (target) openIn(target, sibs)
          break
        }
        case 'copy-link': clipboard.writeText(p.linkURL); break
        case 'save-image': wc.downloadURL(p.srcURL); break
        case 'copy-image': wc.copyImageAt(p.x, p.y); break
        case 'copy-image-address': clipboard.writeText(p.srcURL); break
        case 'spell': if (value) wc.replaceMisspelling(value); break
        case 'undo': wc.undo(); break
        case 'redo': wc.redo(); break
        case 'cut': wc.cut(); break
        case 'copy': wc.copy(); break
        case 'paste': wc.paste(); break
        case 'select-all': wc.selectAll(); break
        case 'back': nav.goBack(); break
        case 'forward': nav.goForward(); break
        case 'reload': wc.reload(); break
      }
    }
    Menu.buildFromTemplate(
      items.map((i) => ('type' in i ? { type: 'separator' as const } : { label: i.label, enabled: i.enabled, click: () => run(i.action, i.value) }))
    ).popup()
  })
}

/** Downloads (D31): hooked once per account session (a session is shared by a rebuilt view). */
const hookedSessions = new WeakSet<object>()
let onDownloadDone: (ok: boolean, file: string) => void = () => {}

// Chrome extensions per account (D49): electron-chrome-extensions once per session (chrome.tabs/windows APIs),
// then installExtension downloads from the Chrome Web Store into <data>/extensions and loads it into that session.
const extSessions = new WeakMap<Electron.Session, ElectronChromeExtensions>()
// Sessions that have an extension API: an update reloads the extension in each of them (D56).
const extSessionSet = new Set<Electron.Session>()
const extErrors = new Map<string, string>()
const extTabs = new WeakSet<Electron.WebContents>()
// One shared download per extension (concurrent installs collided on the same folder: ENOTEMPTY).
const fetchExtension = createExtensionFetcher(extensionsDir(dir), downloadExtension)
// One load per session and extension at a time.
const extLoading = new WeakMap<Electron.Session, Map<string, Promise<unknown>>>()
let onExtChange: () => void = () => {}
function extApiFor(ses: Electron.Session): ElectronChromeExtensions {
  let x = extSessions.get(ses)
  if (!x) {
    x = new ElectronChromeExtensions({
      session: ses,
      // An extension asking for a tab or window (changelog, checkout) opens in the browser; GuiseDesk has no tabs.
      createTab: async (d) => {
        if (d.url) void shell.openExternal(String(d.url))
        throw new Error('tabs are not supported')
      },
      createWindow: async (d) => {
        const u = Array.isArray(d.url) ? d.url[0] : d.url
        if (u) void shell.openExternal(String(u))
        throw new Error('windows are not supported')
      }
    })
    extSessions.set(ses, x)
    extSessionSet.add(ses)
  }
  return x
}
const installedIds = () => listInstalled(extensionsDir(dir)).map((x) => x.id)
/** Loads the account's turned-on extensions into its session (downloads on first use); unloads the ones turned off. */
async function applyExtensions(a: Account, wc: Electron.WebContents, win?: Electron.BaseWindow): Promise<boolean> {
  const want = enabledFor(a, installedIds())
  const ses = wc.session
  const sx = ses.extensions
  if (!want.length && !sx.getAllExtensions().length) return false
  const api = extApiFor(ses)
  if (win && !extTabs.has(wc)) { api.addTab(wc, win); extTabs.add(wc) }
  let changed = false
  for (const e of sx.getAllExtensions()) if (!want.includes(e.id)) { sx.removeExtension(e.id); changed = true }
  for (const id of want) {
    if (sx.getExtension(id)) continue
    try {
      let loads = extLoading.get(ses)
      if (!loads) extLoading.set(ses, (loads = new Map()))
      let p = loads.get(id)
      if (!p) {
        p = fetchExtension(id).then((path) => (sx.getExtension(id) ? undefined : sx.loadExtension(path, { allowFileAccess: false }))).finally(() => loads!.delete(id))
        loads.set(id, p)
      }
      await p
      extErrors.delete(a.id)
      changed = true
    } catch (err) {
      console.error('[guisedesk] extension load failed', id, err)
      extErrors.set(a.id, String((err as Error)?.message ?? err))
    }
  }
  onExtChange()
  return changed
}

const day = () => new Date().toISOString().slice(0, 10)
export interface ExtensionUpdateResult {
  checked: number
  updated: { id: string; version: string }[]
}
/**
 * Auto-update (D56): asks the Chrome Web Store for each installed extension's newest version, downloads the newer
 * ones through the shared fetcher, reloads them in every session that has them on, then drops the old folder. One
 * run at a time: the weekly timer and the Settings button share it.
 */
async function runExtensionUpdates(): Promise<ExtensionUpdateResult> {
  const installed = listInstalled(extensionsDir(dir))
  let found: ExtensionUpdate[] = []
  try {
    found = await checkExtensionUpdates({
      installed,
      chromeVersion: process.versions.chrome,
      fetchText: async (url) => {
        const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      }
    })
  } catch (err) {
    appendEvent(dir, `extension update check failed ${String((err as Error)?.message ?? err)}`)
    return { checked: installed.length, updated: [] }
  }
  const done: ExtensionUpdate[] = []
  for (const u of found) {
    const old = installed.find((x) => x.id === u.id)
    try {
      const path = await fetchExtension(u.id, true)
      for (const ses of extSessionSet) {
        const sx = ses.extensions
        if (!sx.getExtension(u.id)) continue
        try {
          sx.removeExtension(u.id)
          await sx.loadExtension(path, { allowFileAccess: false })
        } catch (err) {
          console.error('[guisedesk] extension reload failed', u.id, err)
        }
      }
      // The new copy is loaded everywhere that wanted it: the old version folder can go.
      if (old && old.path !== path) rmSync(old.path, { recursive: true, force: true })
      done.push(u)
      appendEvent(dir, `extension updated ${u.id} ${u.current} -> ${u.version}`)
    } catch (err) {
      console.error('[guisedesk] extension update failed', u.id, err)
      appendEvent(dir, `extension update failed ${u.id} ${String((err as Error)?.message ?? err)}`)
    }
  }
  if (done.length) {
    const times = loadUpdateTimes(dir)
    for (const u of done) times[u.id] = day()
    saveUpdateTimes(dir, times)
    onExtChange()
  }
  return { checked: installed.length, updated: done.map(({ id, version }) => ({ id, version })) }
}
let extUpdateJob: Promise<ExtensionUpdateResult> | undefined
function updateExtensions(): Promise<ExtensionUpdateResult> {
  if (!extUpdateJob) extUpdateJob = runExtensionUpdates().finally(() => { extUpdateJob = undefined })
  return extUpdateJob
}

interface ExtensionClickApi {
  api?: { browserAction?: { activateClick(d: object): void } }
  ctx?: {
    store?: { getTabById(id: number): unknown; tabDetailsCache?: Map<number, unknown> }
    router?: { sendEvent?(extensionId: string, eventName: string, ...args: unknown[]): void }
  }
}
/**
 * The toolbar click on an extension (D54): open action.default_popup when the manifest has one, else dispatch the
 * click event. MV3 chrome.action.onClicked and MV2 chrome.browserAction.onClicked are both delivered by
 * electron-chrome-extensions under `browserAction.onClicked`; WA Web Plus only reacts to that click event.
 */
function activateExtension(wc: Electron.WebContents, extId: string, win: BrowserWindow): void {
  const api = extSessions.get(wc.session) as unknown as ExtensionClickApi | undefined
  const [w] = win.getSize()
  const anchorRect = { x: w - 360, y: 56, width: 32, height: 32 }
  const installed = listInstalled(extensionsDir(dir)).find((x) => x.id === extId)
  const target = actionClick(installed ? readManifest(installed.path) : {})
  try {
    if (target.kind === 'popup') {
      api?.api?.browserAction?.activateClick({ eventType: 'click', extensionId: extId, tabId: wc.id, anchorRect })
      return
    }
    const ctx = api?.ctx
    const tab = ctx?.store?.getTabById?.(wc.id)
    const details = tab ? ctx?.store?.tabDetailsCache?.get(wc.id) : undefined
    if (ctx?.router?.sendEvent) {
      ctx.router.sendEvent(extId, 'browserAction.onClicked', details)
      return
    }
    // Fallback for another library layout: activateClick also dispatches the click when there is no popup.
    api?.api?.browserAction?.activateClick({ eventType: 'click', extensionId: extId, tabId: wc.id, anchorRect })
  } catch (err) {
    console.error('[guisedesk] extension click failed', extId, err)
  }
}
function hookDownloads(ses: Electron.Session): void {
  if (hookedSessions.has(ses)) return
  hookedSessions.add(ses)
  ses.on('will-download', (_e, item) => {
    const s = loadDownloads(dir)
    const folder = s.dir ?? app.getPath('downloads')
    const name = item.getFilename()
    if (s.ask) item.setSaveDialogOptions({ defaultPath: uniquePath(folder, name, existsSync) })
    else item.setSavePath(uniquePath(folder, name, existsSync))
    item.once('done', (_ev, state) => {
      const path = item.getSavePath()
      onDownloadDone(state === 'completed', path)
    })
  })
}

/** The proxy address for an account's partition (D63); a shared login follows its host. */
const proxyFor = (a: Account): string | undefined => effectiveProxy(a, loadAccounts(dir))

/** Puts a session's proxy in place before its first load; the direct mode clears a proxy removed in the sheet. */
async function configureProxy(ses: Electron.Session, raw: string | undefined): Promise<void> {
  const p = raw ? parseProxy(raw) : undefined
  try {
    if (p && p.ok) await ses.setProxy({ proxyRules: proxyRules(p.value) })
    else await ses.setProxy({ mode: 'direct' })
  } catch (err) {
    appendEvent(dir, `proxy setup failed ${String((err as Error)?.message ?? err)}`)
  }
}

// Proxy sign-in (D63): setProxy carries no credentials. Chromium reports the proxy host and port through the login
// event; main answers with the sign-in saved for that endpoint. The password is only ever read and handed over, never logged.
app.on('login', (event, _wc, _details, authInfo, callback) => {
  if (!authInfo?.isProxy || !isUnlocked()) return
  const cred = findProxyCredential(loadAccounts(dir), loadProxyAuth(dir), authInfo.host, authInfo.port)
  if (!cred) return
  event.preventDefault()
  callback(cred.username, cred.password)
  appendEvent(dir, `proxy sign-in used ${authInfo.host}:${authInfo.port}`)
})

function viewFor(a: Account): WebContentsView {
  let v = views.get(a.id)
  if (!v) {
    v = new WebContentsView({
      webPreferences: {
        partition: partitionOf(a),
        sandbox: true,
        contextIsolation: true,
        devTools,
        preload: join(__dirname, '../preload/index.js'),
        additionalArguments: ['--gd-service', ...(presetFor(a.serviceId)?.postLink ? ['--gd-postlink=' + JSON.stringify(presetFor(a.serviceId)!.postLink)] : []), ...(presetFor(a.serviceId)?.blurMedia ? ['--gd-blur=' + JSON.stringify(presetFor(a.serviceId)!.blurMedia)] : []), ...(presetFor(a.serviceId)?.dragScroll ? ['--gd-dragscroll'] : []), ...(presetFor(a.serviceId)?.keepDeleted ? ['--gd-wakeep'] : [])]
      }
    })
    owner.set(v.webContents.id, a)
    const ses = v.webContents.session
    hookDownloads(ses)
    hookBlocking(ses)
    applyPermissionPolicy(ses)
    const preset = presetFor(a.serviceId)
    v.setBorderRadius(VIEW_RADIUS)
    v.webContents.setUserAgent(preset?.userAgent ?? CHROME_UA)
    hookLinks(v, a)
    hookContextMenu(v.webContents)
    // Saved zoom (D32): applied now and again after each load (a new origin starts at 100%).
    v.webContents.setZoomLevel(a.zoom ?? 0)
    v.webContents.on('dom-ready', () => v!.webContents.setZoomLevel(owner.get(v!.webContents.id)?.zoom ?? 0))
    // Extensions (D49) must be loaded before the page so their content scripts run on it.
    const wc = v.webContents
    // WhatsApp keeps its login in IndexedDB, so the cookie check cannot see it (D50). Once the page is up, look for
    // the QR screen versus the chat panel and record whether the login survived.
    if (a.serviceId === 'whatsapp') wc.once('did-finish-load', () => scheduleLoginCheck(2500))
    const start = preset?.startUrl ?? a.custom?.url ?? 'about:blank'
    // The proxy (D63) is in place before anything loads; a shared login uses its host's proxy.
    void configureProxy(ses, proxyFor(a)).then(() => {
      if (wc.isDestroyed()) return
      if (enabledFor(a, installedIds()).length) void applyExtensions(a, wc, mainWin).finally(() => !wc.isDestroyed() && wc.loadURL(start))
      else wc.loadURL(start)
    })
    views.set(a.id, v)
  }
  return v
}

/** Page notification (D4): decide, then show a native one; click shows the window and selects the account. */
function notify(win: BrowserWindow, a: Account, p: { title?: string; body?: string; icon?: string }, onClick: () => void): void {
  const event = {
    accountId: a.id,
    serviceName: presetFor(a.serviceId)?.name ?? a.custom?.name ?? a.serviceId,
    label: a.label,
    title: String(p.title ?? '').slice(0, 200),
    body: String(p.body ?? '').slice(0, 1000),
    icon: p.icon
  }
  const locked = !isUnlocked()
  const d = decideNotification(event, {
    muted: a.muted,
    dnd,
    quiet: quietOutsideWorkHours(quietWork, quietSchedule, new Date()),
    asleep: hib.isAsleep(a.id),
    locked,
    disabled: disabled.has(a.serviceId)
  })
  // Every notification is kept in the inbox, even when the native one is dropped (muted, DND, asleep).
  // While locked only the account id and a generic title are stored; the sender and the body never reach disk.
  if (!disabled.has(a.serviceId)) {
    inbox = addInbox(inbox, inboxItem(event, { id: randomUUID(), time: Date.now(), locked }))
    saveInbox(dir, inbox)
    onInbox()
  }
  if (d.action === 'drop' || !Notification.isSupported()) return
  // Linux has no subtitle: the service line goes under the body (frame 7).
  const n = new Notification({ title: d.title, body: [d.body, d.subtitle].filter(Boolean).join('\n') })
  live.add(n)
  n.on('click', onClick)
  n.on('close', () => live.delete(n))
  n.show()
}

/** Puts the selected view in the panel. A view rebuilt from sleep is attached only once its page has loaded; the asleep panel covers the gap. */
function attach(win: BrowserWindow, v: WebContentsView): void {
  if (win.isDestroyed() || dialogOpen || !isUnlocked() || attached !== v || (attachedId && sleepState[attachedId]?.waking)) return
  if (!win.contentView.children.includes(v)) win.contentView.addChildView(v)
  if (second && !win.contentView.children.includes(second)) win.contentView.addChildView(second)
  layoutViews(win)
}

function detach(win: BrowserWindow, v: WebContentsView): void {
  if (!win.isDestroyed() && win.contentView.children.includes(v)) win.contentView.removeChildView(v)
}

/** Resizes the attached view, and the second one when split is on (D62). */
function layoutViews(win: BrowserWindow): void {
  if (win.isDestroyed() || !attached) return
  const b = panelBounds(win)
  if (second) {
    const { left, right } = splitBounds(b, splitRatio)
    attached.setBounds(left)
    second.setBounds(right)
  } else attached.setBounds(b)
}

/** Ends split view: detaches the second page, clears the saved setting unless asked to keep it. */
function endSplit(save = true): void {
  if (!second && !splitB) return
  if (second && mainWin) detach(mainWin, second)
  second = undefined
  splitB = undefined
  focusedId = undefined
  if (save) saveSplit(dir, undefined)
  if (mainWin && attached) layoutViews(mainWin)
  onSplitChange()
}

function show(win: BrowserWindow, a: Account, push: () => void): void {
  endSplit()
  if (attached) detach(win, attached)
  hib.touch(a.id)
  const wasAsleep = hib.isAsleep(a.id)
  if (wasAsleep) {
    hib.wake(a.id)
    sleepState[a.id] = { ...sleepState[a.id], waking: true }
  }
  const v = viewFor(a)
  attached = v
  attachedId = a.id
  focusedId = a.id
  if (wasAsleep) {
    const done = () => {
      if (!sleepState[a.id]?.waking) return
      delete sleepState[a.id]
      push()
      attach(win, v)
    }
    v.webContents.once('did-finish-load', done)
    v.webContents.once('did-fail-load', done)
    push()
    return
  }
  attach(win, v)
}

function sleepAccount(a: Account, minutes = limitMinutes(a) ?? 0): void {
  popups.closeFor(a.id)
  if (a.id === splitB) endSplit()
  const v = views.get(a.id)
  if (v) {
    owner.delete(v.webContents.id)
    views.delete(a.id)
    v.webContents.close()
  }
  sleepState[a.id] = { minutes, waking: false }
}

function setDialog(win: BrowserWindow, open: boolean): void {
  if (open === dialogOpen) return
  dialogOpen = open
  if (!attached) return
  if (open) {
    detach(win, attached)
    if (second) detach(win, second)
  } else attach(win, attached)
}

let mainWin: BrowserWindow | undefined
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#15151c',
    autoHideMenuBar: true,
    title: 'GuiseDesk',
    icon: join(__dirname, '../../resources/icon.png'),
    // Started on login (--hidden): stay in the tray. The lock still starts locked.
    show: !startsHidden(process.argv),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      devTools
    }
  })
  mainWin = win
  // Dev-only: GUISEDESK_SHOT_DIALOG=add opens the Add account dialog, =reset the reset confirm screen, for the screenshot.
  // =settings opens Settings with the sheet of account GUISEDESK_SHOT_SHEET.
  const dialogQuery =
    process.env.GUISEDESK_SHOT && ['add', 'reset', 'settings'].includes(process.env.GUISEDESK_SHOT_DIALOG ?? '')
      ? `dialog=${process.env.GUISEDESK_SHOT_DIALOG}&sheet=${encodeURIComponent(process.env.GUISEDESK_SHOT_SHEET ?? '')}&tab=${encodeURIComponent(process.env.GUISEDESK_SHOT_TAB ?? '')}`
      : ''
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + (dialogQuery && `?${dialogQuery}`))
  else win.loadFile(join(__dirname, '../renderer/index.html'), { search: dialogQuery })

  const showWindow = () => {
    win.show()
    win.focus()
  }
  // Ctrl+K (D59) from the window or a service view: raise the window and let the renderer open the dialog.
  openSwitcher = () => {
    showWindow()
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('ui:switcher')
  }
  // F1 (D60): raise the window and let the renderer show the shortcut cheat sheet.
  openHelp = () => {
    showWindow()
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('ui:help')
  }
  // A second launch: raise this window (lock state unchanged) unless it was a --hidden login start.
  app.on('second-instance', (_e, argv) => {
    if (secondLaunch(argv) === 'ignore') return
    if (win.isMinimized()) win.restore()
    showWindow()
  })
  dnd = loadDnd(dir)
  quietWork = loadQuietWorkHours(dir)
  quietSchedule = loadSchedule(dir)
  // Tray Settings: raise the window, and open the screen only when unlocked (the renderer ignores it otherwise too).
  const openSettings = () => {
    showWindow()
    if (isUnlocked()) win.webContents.send('settings:open')
  }
  const tray = createTray(showWindow, () => lock.lock(), openSettings, dnd, (on) => {
    dnd = on
    saveDnd(dir, on)
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('prefs:dnd-changed', on)
  })
  // Close hides to the tray; only quitting (tray Quit, session end) really closes.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })

  disabled = new Set(loadDisabled(dir))
  sidebarCollapsed = loadSidebarCollapsed(dir)
  // The rail changes the panel width: tell the renderer and resize the attached view at once.
  const setSidebar = (c: boolean) => {
    if (c === sidebarCollapsed) return
    sidebarCollapsed = c
    saveSidebarCollapsed(dir, c)
    layoutViews(win)
    if (!win.isDestroyed()) win.webContents.send('sidebar:changed', c)
  }
  const sideLayout = loadSidebarLayout(dir)
  sidebarWidth = clampSide(sideLayout.width)
  sidebarHidden = sideLayout.hidden
  const pushLayout = () => {
    layoutViews(win)
    if (!win.isDestroyed()) win.webContents.send('sidebar:layout', { collapsed: sidebarCollapsed, hidden: sidebarHidden, width: sidebarWidth })
  }
  // Ctrl+B: a hidden sidebar comes back first; otherwise it switches between full and rail.
  toggleSidebar = () => {
    if (sidebarHidden) {
      sidebarHidden = false
      saveSidebarLayout(dir, { width: sidebarWidth, hidden: false })
      pushLayout()
    } else setSidebar(!sidebarCollapsed)
  }
  let accounts = orderedAccounts(loadAccounts(dir))
  inbox = loadInbox(dir)
  const enabled = () => accounts.filter((a) => !disabled.has(a.serviceId))
  let selectedId = loadSelected(dir)
  if (!enabled().some((a) => a.id === selectedId)) selectedId = enabled()[0]?.id
  // Split view saved in settings.json (D62) comes back when both accounts still exist and the main one is selected.
  const savedSplit = loadSplit(dir)
  const restorableSplit =
    savedSplit && savedSplit.a === selectedId && savedSplit.b !== selectedId && enabled().some((a) => a.id === savedSplit.b) ? savedSplit : undefined
  if (savedSplit && !restorableSplit) saveSplit(dir, undefined)
  // Accounts whose deleted-message keeper could not find WhatsApp's store (D47b); shown as a note in the sheet.
  const keeperDown = new Set<string>()
  // Custom icons are cached files; the renderer gets them as data URLs. A shared login shows the host's proxy (D63).
  const snapshot = () => {
    const proxyAuth = loadProxyAuth(dir)
    return {
      accounts: accounts.map((a) => {
        const row0 = keeperDown.has(a.id) ? { ...a, keeperUnavailable: true } : a
        const row = extErrors.has(a.id) ? { ...row0, extError: extErrors.get(a.id) } : row0
        const owner = proxyHostOf(a, accounts)
        const proxy = owner?.proxy
        const cred = proxy ? proxyAuth[partitionKey(owner!)] : undefined
        const row1 = { ...row, ...(proxy ? { proxy } : {}), ...(cred ? { proxyUser: cred.username } : {}) }
        return a.custom ? { ...row1, custom: { ...a.custom, icon: readIcon(dir, a.custom.icon) } } : row1
      }),
      selectedId,
      disabledServices: [...disabled],
      sidebarCollapsed,
      sidebarHidden,
      sidebarWidth,
      ...(splitB && attachedId ? { split: { b: splitB, ratio: splitRatio } } : {})
    }
  }
  // Split view (D62): the top bar shows Close split and the renderer draws the divider from this state.
  const splitSnapshot = () => (splitB && attachedId ? { b: splitB, ratio: splitRatio } : undefined)
  onSplitChange = () => {
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('split:changed', splitSnapshot())
  }
  const spread = (): string | undefined => (splitB && (focusedId === splitB || focusedId === attachedId) ? focusedId : attachedId)
  /** Starts split view (D62): the picked account gets its own view and session, next to the selected one. */
  const startSplit = (bId: string) => {
    if (!attached || !attachedId) return
    const a = accounts.find((x) => x.id === attachedId)
    const b = enabled().find((x) => x.id === bId)
    if (!a || !b || b.id === a.id || (splitB === b.id && second)) return
    if (second) endSplit(false)
    splitB = b.id
    splitRatio = clampSplit(splitRatio)
    if (hib.isAsleep(b.id)) {
      hib.wake(b.id)
      delete sleepState[b.id]
    }
    second = viewFor(b)
    attach(win, attached)
    saveSplit(dir, { a: a.id, b: b.id, ratio: splitRatio })
    appendEvent(dir, `split view ${a.id} + ${b.id}`)
    onSplitChange()
    pushSleep()
  }
  const closeSplit = () => {
    if (!splitB && !second) return
    const was = splitB
    endSplit(true)
    appendEvent(dir, `split view closed${was ? ` (${was})` : ''}`)
  }
  /** Restores a saved split after the main account is on screen; a sleeping second account wakes first. */
  const restoreSplit = (s: SplitState) => {
    const b = enabled().find((x) => x.id === s.b)
    if (!attached || !b || b.id === attachedId) {
      saveSplit(dir, undefined)
      return
    }
    splitB = b.id
    splitRatio = clampSplit(s.ratio)
    if (hib.isAsleep(b.id)) {
      hib.wake(b.id)
      delete sleepState[b.id]
    }
    second = viewFor(b)
    attach(win, attached)
    appendEvent(dir, `split view restored ${attachedId} + ${b.id}`)
    onSplitChange()
    pushSleep()
  }
  // Zoom (D32): Ctrl+= / Ctrl+- / Ctrl+0 act on the shown account; saved per account, pushed to the renderer for the top bar chip.
  const changeZoom = (id: string, level: number) => {
    accounts = orderedAccounts(setZoom(dir, id, level))
    const v = views.get(id)
    const held = owner.get(v?.webContents.id ?? -1)
    if (held) held.zoom = level === 0 ? undefined : level
    v?.webContents.setZoomLevel(level)
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('accounts:zoom', snapshot())
  }
  zoomKeyDown = (input) => {
    const dirKey = zoomKey(input)
    if (!dirKey) return false
    const a = isUnlocked() && !dialogOpen ? accounts.find((x) => x.id === spread()) : undefined
    if (a) changeZoom(a.id, nextZoom(a.zoom ?? 0, dirKey))
    return true
  }
  const fromApp = (e: { sender: { id: number } }) => e.sender.id === win.webContents.id
  // Inbox (D64): the renderer gets the items and the unread count (muted accounts are kept but not counted).
  const inboxView = () => {
    const muted = new Set(accounts.filter((a) => a.muted).map((a) => a.id))
    return { items: inbox, unread: unreadCount(inbox, muted) }
  }
  const pushInbox = () => {
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('inbox:update', inboxView())
  }
  onInbox = pushInbox
  ipcMain.removeHandler('lock:state')
  ipcMain.handle('lock:state', (e) => (fromApp(e) ? lock.info() : { state: 'locked' }))
  ipcMain.removeHandler('lock:setup')
  ipcMain.handle('lock:setup', (e, kind, secret, repeat) => (fromApp(e) ? lock.setup(kind, secret, repeat) : { error: 'Refused' }))
  ipcMain.removeHandler('lock:unlock')
  ipcMain.handle('lock:unlock', (e, entry) => (fromApp(e) ? lock.unlock(entry) : { result: 'wrong' }))
  ipcMain.removeAllListeners('lock:lock')
  ipcMain.on('lock:lock', (e) => fromApp(e) && lock.lock())
  // Idle (D15): the app window and service views report mouse input through the preload; keys come from before-input-event.
  // The setting is read at start; Settings changes it through applyIdle (setMinutes).
  const triggers = wireTriggers({ lock, power: powerMonitor, now: Date.now, minutes: loadIdleMinutes(dir), schedule: loadSchedule(dir) })
  touchIdle = triggers.touch
  // Lock countdown (D57): the top bar shows the time left under the current rule, and the chip opens a native menu.
  const lockCountdown = (): { ms: number; rule: string } | null => {
    if (!isUnlocked()) return null
    const ms = triggers.remainingMs()
    const rule = triggers.rule()
    return ms === null || !rule ? null : { ms, rule }
  }
  const pushCountdown = () => {
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('lock:countdown', lockCountdown())
  }
  const addFifteen = () => {
    if (!isUnlocked()) return
    triggers.extend(15 * 60_000)
    appendEvent(dir, 'lock extended 15 min')
    pushCountdown()
  }
  let warnedDeadline = 0
  const warnOneMinute = () => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'GuiseDesk locks in 1 minute', body: 'Click to add 15 minutes.' })
    live.add(n)
    n.on('click', addFifteen)
    n.on('close', () => live.delete(n))
    n.show()
  }
  setInterval(() => {
    if (isUnlocked()) {
      const ms = triggers.remainingMs()
      if (ms !== null && ms > 0 && ms <= 60_000) {
        const deadline = Date.now() + ms
        if (deadline !== warnedDeadline) {
          warnedDeadline = deadline
          warnOneMinute()
        }
      }
    }
    triggers.check()
    pushCountdown()
  }, 10_000).unref()
  ipcMain.removeAllListeners('idle:touch')
  ipcMain.removeHandler('blur:state')
  ipcMain.handle('blur:state', (e) => blurState(owner.get(e.sender.id)))
  // D47b: the keeper script only runs when the account switched it on; a failed hook reports 'unavailable' here.
  ipcMain.removeHandler('wakeep:enabled')
  ipcMain.handle('wakeep:enabled', (e) => !!owner.get(e.sender.id)?.keepDeleted)
  ipcMain.removeAllListeners('wakeep:state')
  ipcMain.on('wakeep:state', (e, s) => {
    const a = owner.get(e.sender.id)
    if (!a || (s !== 'ok' && s !== 'unavailable')) return
    if (s === 'unavailable') keeperDown.add(a.id)
    else keeperDown.delete(a.id)
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('accounts:zoom', snapshot())
  })
  ipcMain.on('popup:request', (e, url) => {
    const a = owner.get(e.sender.id)
    const u = a && isUnlocked() ? acceptPopupRequest(url, a) : null
    if (a && u) openPopup(a, u)
  })
  ipcMain.on('post:at-result', (e, id, url) => {
    if (owner.has(e.sender.id) && typeof id === 'number') postWaiters.get(id)?.(typeof url === 'string' ? url : null)
  })
  ipcMain.on('idle:touch', (e) => (fromApp(e) || owner.has(e.sender.id)) && triggers.touch())
  // Self-update (D29): check once the window is up and every 12 h; apply hands over to a temp copy of update.sh and quits.
  const root = appRoot(app.getAppPath(), existsSync)
  let update: UpdateInfo | { state: 'checking' } = { state: 'checking' }
  const setUpdate = (u: UpdateInfo) => {
    update = u
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('update:changed', u)
  }
  const runCheck = async () => {
    const u = await checkForUpdate({ root, current: version, env: process.env, run: realRun })
    setUpdate(u)
    return u
  }
  win.webContents.once('did-finish-load', () => void runCheck())
  setInterval(() => void runCheck(), 12 * 3600_000).unref()
  gipc.handle('update:state', (e: { sender: { id: number } }) => (fromApp(e) ? update : undefined))
  gipc.handle('update:check', (e: { sender: { id: number } }) => (fromApp(e) ? runCheck() : undefined))
  gipc.handle('update:apply', (e: { sender: { id: number } }) => {
    // A custom build must never run update.sh: it would check out LastNyx's tag and drop the local commits (D55).
    if (!fromApp(e) || ('custom' in update && !!update.custom) || update.state !== 'available' || !('latest' in update) || !update.latest) return false
    // update.sh is copied first: the checkout rewrites launchers/update.sh while the script runs.
    const copy = join(mkdtempSync(join(tmpdir(), 'guisedesk-update-')), 'update.sh')
    copyFileSync(join(root, 'launchers', 'update.sh'), copy)
    const log = openSync(join(dir, 'update.log'), 'a')
    spawn('sh', [copy, update.latest, String(process.pid), root, join(dir, 'update.log')], { detached: true, stdio: ['ignore', log, log] }).unref()
    app.quit()
    return true
  })
  // Downloads (D31): finished notice respects DND; locked hides the name; a click shows the file in its folder.
  onDownloadDone = (ok, path) => {
    if (dnd || quietOutsideWorkHours(quietWork, quietSchedule, new Date()) || !Notification.isSupported()) return
    const d = doneNotice({ ok, file: basename(path), locked: !isUnlocked() })
    const n = new Notification({ title: d.title, body: d.body })
    live.add(n)
    if (ok && path) n.on('click', () => shell.showItemInFolder(path))
    n.on('close', () => live.delete(n))
    n.show()
  }
  const downloadsView = () => {
    const s = loadDownloads(dir)
    return { dir: s.dir ?? app.getPath('downloads'), ask: s.ask }
  }
  gipc.handle('downloads:get', (e: { sender: { id: number } }) => (fromApp(e) ? downloadsView() : undefined))
  gipc.handle('downloads:set', (e: { sender: { id: number } }, v: { ask?: unknown }) => {
    if (!fromApp(e) || !v || typeof v !== 'object') return false
    saveDownloads(dir, { ...loadDownloads(dir), ask: v.ask === true })
    return true
  })
  gipc.handle('downloads:pick', async (e: { sender: { id: number } }) => {
    if (!fromApp(e)) return undefined
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: downloadsView().dir })
    const picked = r.canceled ? undefined : r.filePaths[0]
    if (picked) saveDownloads(dir, { ...loadDownloads(dir), dir: picked })
    return picked
  })
  // Backup and restore (D61): export packs in a worker and writes one encrypted file; restore is staged, then
  // applied by the next start before any session exists.
  const backupInput = (v: unknown) =>
    v && typeof v === 'object' ? (v as { file?: unknown; password?: unknown; includeLogins?: unknown }) : undefined
  gipc.handle('backup:export', async (e: { sender: { id: number } }, raw: unknown) => {
    if (!fromApp(e)) return { error: 'Refused' }
    const v = backupInput(raw)
    const password = typeof v?.password === 'string' ? v.password : ''
    if (password.length < 8) return { error: 'Use at least 8 characters.' }
    const includeLogins = v?.includeLogins === true
    const picked = await dialog.showSaveDialog(win, {
      title: 'Export backup',
      defaultPath: join(app.getPath('documents'), backupFileName(new Date())),
      filters: [{ name: 'GuiseDesk backup', extensions: ['gdbackup'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }
    const file = picked.filePath.toLowerCase().endsWith('.gdbackup') ? picked.filePath : `${picked.filePath}.gdbackup`
    try {
      // Flush cookies and storage first, so the partition copy on disk is as fresh as the running sessions allow.
      if (includeLogins) {
        for (const key of new Set(accounts.map(partitionKey))) {
          const ses = session.fromPartition(`persist:${key}`)
          await ses.cookies.flushStore().catch(() => {})
          ses.flushStorageData()
        }
      }
      const made = await runBackupWorker({ op: 'export', dataDir: dir, includeLogins, password, version })
      if (!made.bytes) return { error: 'The backup could not be created.' }
      writeAtomic(file, made.bytes, undefined, 0o600)
      appendEvent(dir, `backup exported ${basename(file)}${includeLogins ? ' with logins' : ''}`)
      return { ok: true, file, manifest: made.manifest }
    } catch (err) {
      console.error('[guisedesk] backup export failed', err)
      appendEvent(dir, `backup export failed ${String((err as Error)?.message ?? err)}`)
      return { error: `Could not create the backup: ${String((err as Error)?.message ?? err)}` }
    }
  })
  gipc.handle('backup:pick', async (e: { sender: { id: number } }) => {
    if (!fromApp(e)) return { canceled: true }
    const picked = await dialog.showOpenDialog(win, {
      title: 'Restore backup',
      properties: ['openFile'],
      filters: [{ name: 'GuiseDesk backup', extensions: ['gdbackup'] }]
    })
    return picked.canceled || !picked.filePaths[0] ? { canceled: true } : { file: picked.filePaths[0] }
  })
  gipc.handle('backup:inspect', async (e: { sender: { id: number } }, raw: unknown) => {
    if (!fromApp(e)) return { error: 'Refused' }
    const v = backupInput(raw)
    const file = typeof v?.file === 'string' ? v.file : ''
    const password = typeof v?.password === 'string' ? v.password : ''
    if (!file || !password) return { error: 'Choose the backup file and type its password.' }
    try {
      const r = await runBackupWorker({ op: 'inspect', file, password })
      return { manifest: r.manifest }
    } catch (err) {
      return { error: String((err as Error)?.message ?? err) }
    }
  })
  gipc.handle('backup:restore', async (e: { sender: { id: number } }, raw: unknown) => {
    if (!fromApp(e)) return { error: 'Refused' }
    const v = backupInput(raw)
    const file = typeof v?.file === 'string' ? v.file : ''
    const password = typeof v?.password === 'string' ? v.password : ''
    if (!file || !password) return { error: 'Choose the backup file and type its password.' }
    try {
      const r = await runBackupWorker({ op: 'prepare', file, password, dataDir: dir })
      if (!r.manifest) return { error: 'The backup could not be restored.' }
      appendEvent(dir, `restore prepared (${r.manifest.accounts} accounts, ${r.manifest.extensions.length} extensions${r.manifest.includeLogins ? ', with logins' : ''}); quitting`)
      // Give the reply time to reach the renderer; the window may show "Restoring..." for a moment.
      setTimeout(() => app.quit(), 200)
      return { ok: true, manifest: r.manifest }
    } catch (err) {
      appendEvent(dir, `restore failed ${String((err as Error)?.message ?? err)}`)
      return { error: `Could not restore the backup: ${String((err as Error)?.message ?? err)}` }
    }
  })
  // Ad and pop-up blocking (D45): Settings > General. Ads apply to every open session at once; pop-ups to the next window.open.
  gipc.handle('blocking:get', (e: { sender: { id: number } }) => (fromApp(e) ? blocking : undefined))
  gipc.handle('blocking:set', async (e: { sender: { id: number } }, v: { ads?: unknown; popups?: unknown }) => {
    if (!fromApp(e) || !v || typeof v !== 'object') return false
    const next = { ads: typeof v.ads === 'boolean' ? v.ads : blocking.ads, popups: typeof v.popups === 'boolean' ? v.popups : blocking.popups }
    const adsChanged = next.ads !== blocking.ads
    blocking = next
    saveBlocking(dir, next)
    if (adsChanged) {
      await Promise.all([...blockSessions].map((ses) => adblock.setSession(ses, dispatcherFor(ses), next.ads)))
      for (const v of views.values()) if (!v.webContents.isDestroyed()) v.webContents.reload()
    }
    pushBlock()
    return true
  })
  // Top bar chips (D45): counts and the dropped pop-up per account; "open anyway" runs the normal window.open handling.
  const pushBlock = () => {
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('block:update', { ads: blocking.ads, accounts: blockState.snapshot() })
  }
  onBlockChange = pushBlock
  gipc.handle('block:state', (e: { sender: { id: number } }) => (fromApp(e) ? { ads: blocking.ads, accounts: blockState.snapshot() } : undefined))
  // Shield chip (D45): a native menu (it shows above the service view) with the stats and actions.
  gipc.on('block:menu', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && accounts.find((x) => x.id === id)
    if (!a) return
    Menu.buildFromTemplate(
      shieldMenuItems(blockState.get(a.id), blocking.ads).map((i) =>
        i.separator ? { type: 'separator' as const } : {
          label: i.label,
          enabled: i.enabled,
          click: () => {
            if (i.action === 'settings') win.webContents.send('settings:open-tab', 'General')
            else if (i.action === 'open-popup') {
              const v = views.get(a.id)
              const url = v && !v.webContents.isDestroyed() ? blockState.take(a.id) : undefined
              if (v && url) openFromView(v.webContents, a, url, 'foreground-tab')
            }
          }
        }
      )
    ).popup({ window: win })
  })
  gipc.handle('block:open-popup', (e: { sender: { id: number } }, id: string) => {
    if (!fromApp(e) || typeof id !== 'string') return false
    const a = accounts.find((x) => x.id === id)
    const v = views.get(id)
    const url = a && v && !v.webContents.isDestroyed() ? blockState.take(id) : undefined
    if (!a || !v || !url) return false
    openFromView(v.webContents, a, url, 'foreground-tab')
    return true
  })
  // Settings > Lock, Notifications, General. All behind the guard; the idle choice reaches the running timer.
  const autostartOpts = () => ({ env: process.env, home: homedir(), appPath: appRoot(app.getAppPath(), existsSync) })
  gipc.handle('prefs:get', (e: { sender: { id: number } }) =>
    fromApp(e)
      ? { idleLock: loadIdleMinutes(dir), dnd, quietWorkHours: quietWork, startOnLogin: isAutostart(autostartOpts()) }
      : undefined
  )
  // Lock schedule (D51): saved, then handed to the running timer.
  gipc.handle('prefs:schedule-get', (e: { sender: { id: number } }) => (fromApp(e) ? loadSchedule(dir) : undefined))
  gipc.handle('prefs:schedule', (e: { sender: { id: number } }, v: unknown) => {
    if (!fromApp(e)) return undefined
    const s = normalizeSchedule(v)
    saveSchedule(dir, s)
    triggers.setSchedule(s)
    quietSchedule = s
    appendEvent(dir, `lock schedule ${JSON.stringify(s)}`)
    return s
  })
  // Lock countdown (D57): the chip's current state, and the native menu it opens.
  gipc.handle('lock:countdown', (e: { sender: { id: number } }) => (fromApp(e) ? lockCountdown() : undefined))
  gipc.on('lock:menu', (e: { sender: { id: number } }) => {
    if (!fromApp(e)) return
    const c = lockCountdown()
    Menu.buildFromTemplate([
      ...(c ? [{ label: c.rule, enabled: false }] : []),
      { type: 'separator' as const },
      { label: 'Add 15 minutes', enabled: !!c, click: addFifteen },
      { label: 'Lock now', click: () => lock.lock() },
      {
        label: 'Lock settings...',
        click: () => {
          showWindow()
          if (isUnlocked() && !win.isDestroyed()) win.webContents.send('settings:open-tab', 'Lock')
        }
      }
    ]).popup({ window: win })
  })
  gipc.handle('prefs:idle', (e: { sender: { id: number } }, v: unknown) => fromApp(e) && applyIdle(dir, v, triggers))
  gipc.handle('prefs:dnd', (e: { sender: { id: number } }, on: unknown) => {
    if (!fromApp(e)) return false
    dnd = !!on
    saveDnd(dir, dnd)
    tray.setDnd(dnd)
    return true
  })
  // Quiet outside work hours (D58): its own switch, next to DND; the tray DND state is unchanged.
  gipc.handle('prefs:quiet-work-hours', (e: { sender: { id: number } }, on: unknown) => {
    if (!fromApp(e)) return false
    quietWork = !!on
    saveQuietWorkHours(dir, quietWork)
    appendEvent(dir, `quiet outside work hours ${quietWork ? 'on' : 'off'}`)
    return true
  })
  gipc.handle('prefs:autostart', (e: { sender: { id: number } }, on: unknown) => {
    if (!fromApp(e)) return false
    try {
      setAutostart(autostartOpts(), !!on)
      return true
    } catch (err) {
      console.error('autostart failed:', err)
      return false
    }
  })
  gipc.handle('lock:change', (e: { sender: { id: number } }, current: string, kind: 'pin' | 'password', secret: string, repeat: string) =>
    fromApp(e) ? lock.change(String(current ?? ''), kind, String(secret ?? ''), String(repeat ?? '')) : { error: 'Refused' }
  )
  // Reset (D14): after RESET is typed, drop every view, wipe the partitions' storage, delete the files, back to setup.
  ipcMain.removeHandler('lock:reset')
  ipcMain.handle('lock:reset', async (e, typed) => {
    if (!fromApp(e) || lock.state() === 'setup') return { error: 'Refused' }
    if (typed !== RESET_WORD) return { error: `Type ${RESET_WORD} to confirm` }
    appendEvent(dir, 'reset (all data wiped from the app)')
    const keys = new Set([...loadAccounts(dir).map(partitionKey), ...views.keys()])
    if (second) detach(win, second)
    second = undefined
    splitB = undefined
    saveSplit(dir, undefined)
    if (attached) detach(win, attached)
    attached = undefined
    attachedId = undefined
    for (const v of views.values()) {
      owner.delete(v.webContents.id)
      v.webContents.close()
    }
    views.clear()
    for (const key of keys) {
      const ses = session.fromPartition(`persist:${key}`)
      await ses.clearStorageData().catch(() => {})
      await ses.clearCache().catch(() => {})
    }
    const r = resetData(dir, typed)
    if ('error' in r) return r
    accounts = []
    selectedId = undefined
    inbox = []
    saveInbox(dir, inbox)
    for (const k of Object.keys(counts)) delete counts[k]
    for (const k of Object.keys(sleepState)) delete sleepState[k]
    lock.reset()
    return r
  })
  // Ctrl+L inside the app UI (a focused service view is handled in hookLinks).
  win.webContents.on('before-input-event', (e, input) => {
    touchIdle()
    if (isSidebarShortcut(input) && isUnlocked()) {
      e.preventDefault()
      toggleSidebar()
      return
    }
    // Ctrl+K (D59): the renderer opens the quick switcher and detaches the view.
    if (isSwitcherShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openSwitcher()
      return
    }
    // F1 (D60): the shortcut cheat sheet, from the window too.
    if (isHelpShortcut(input) && isUnlocked()) {
      e.preventDefault()
      openHelp()
      return
    }
    if (zoomKeyDown(input) || switchKeyDown(input)) {
      e.preventDefault()
      return
    }
    if (!isLockShortcut(input)) return
    e.preventDefault()
    lock.lock()
  })
  lock.onChange(() => {
    if (win.isDestroyed()) return
    if (isUnlocked()) {
      if (attached) attach(win, attached)
    } else {
      // Views keep running; they just leave the window. The renderer wipes its own account data on 'locked'.
      dialogOpen = false
      pending = undefined
      popups.closeAll()
      if (attached) detach(win, attached)
      if (second) detach(win, second)
      win.webContents.focus()
    }
    tray.setUnread(totalUnread(counts), !isUnlocked())
    win.webContents.send('lock:changed', lock.info())
  })
  gipc.handle('accounts:state', snapshot)
  const push = () => {
    tray.setUnread(totalUnread(counts), !isUnlocked())
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('unread:update', counts)
  }
  const pushSleep = () => {
    if (!win.isDestroyed() && isUnlocked()) win.webContents.send('sleep:update', { ...sleepState })
  }
  gipc.handle('sleep:get', () => ({ ...sleepState }))
  // D39: every account but the selected one starts asleep, like Sleep now (minutes 0). No views exist yet, so only state is set.
  for (const id of launchAsleep(accounts, selectedId)) {
    hib.sleep(id)
    sleepState[id] = { minutes: 0, waking: false }
  }
  // Dev-only: GUISEDESK_FAKE_ASLEEP=<id> starts that account asleep (stays asleep even if selected, so the panel can be shot).
  const fakeAsleep = process.env.GUISEDESK_FAKE_ASLEEP
  if (accounts.some((a) => a.id === fakeAsleep)) {
    hib.sleep(fakeAsleep!)
    sleepState[fakeAsleep!] = { minutes: 30, waking: false }
  }
  // GUISEDESK_SLEEP_TICK_MS (dev-only) shortens the one-minute sweep.
  setInterval(() => {
    for (const id of hib.sweep(accounts, selectedId)) sleepAccount(accounts.find((a) => a.id === id)!)
    pushSleep()
  }, Number(process.env.GUISEDESK_SLEEP_TICK_MS) || 60_000).unref()
  onCounts = push
  for (const pair of fakeCounts?.split(',') ?? []) {
    const [id, n] = pair.split('=')
    if (id) counts[id] = Number(n) || 0
  }
  gipc.handle('unread:get', () => ({ ...counts }))
  // Inbox (D64): the dialog reads, marks one item read, marks all read, or clears. Every change is saved and pushed.
  gipc.handle('inbox:get', (e: { sender: { id: number } }) => (fromApp(e) ? inboxView() : undefined))
  gipc.handle('inbox:read', (e: { sender: { id: number } }, id: unknown) => {
    if (!fromApp(e) || typeof id !== 'string') return undefined
    inbox = markRead(inbox, id)
    saveInbox(dir, inbox)
    pushInbox()
    return inboxView()
  })
  gipc.handle('inbox:read-all', (e: { sender: { id: number } }) => {
    if (!fromApp(e)) return undefined
    inbox = markAllRead(inbox)
    saveInbox(dir, inbox)
    pushInbox()
    return inboxView()
  })
  gipc.handle('inbox:clear', (e: { sender: { id: number } }) => {
    if (!fromApp(e)) return undefined
    inbox = []
    saveInbox(dir, inbox)
    appendEvent(dir, 'notification inbox cleared')
    pushInbox()
    return inboxView()
  })
  push()
  // Selected account gone or its service switched off: show the first account still in the sidebar, or none.
  const reconcile = () => {
    if (splitB && !enabled().some((a) => a.id === splitB)) endSplit()
    if (enabled().some((a) => a.id === selectedId)) return
    if (attached) detach(win, attached)
    attached = undefined
    attachedId = undefined
    const next = enabled()[0]
    selectedId = next?.id
    if (!next) return
    saveSelected(dir, next.id)
    show(win, next, pushSleep)
  }
  gipc.handle('services:set', (_e: unknown, serviceId: string, on: boolean) => {
    if (typeof serviceId !== 'string') return snapshot()
    disabled = new Set(setServiceEnabled(dir, serviceId, !!on))
    reconcile()
    return snapshot()
  })
  // Drag reorder (D28): a bad id list is ignored and the current snapshot returned.
  gipc.handle('accounts:reorder', (_e: unknown, ids: unknown) => {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return snapshot()
    try {
      accounts = orderedAccounts(reorderAccounts(dir, ids))
    } catch (err) {
      console.error('reorder failed:', err)
    }
    push()
    return snapshot()
  })
  gipc.handle('accounts:policy', (_e: unknown, id: string, policy: string) => {
    if (!accounts.some((a) => a.id === id) || !IDLE_POLICIES.includes(policy)) return snapshot()
    accounts = orderedAccounts(setIdlePolicy(dir, id, policy))
    const held = owner.get(views.get(id)?.webContents.id ?? -1)
    if (held) held.idlePolicy = policy
    return snapshot()
  })
  const clearStorage = async (key: string) => {
    const ses = session.fromPartition(`persist:${key}`)
    await ses.clearStorageData().catch(() => {})
    await ses.clearCache().catch(() => {})
  }
  gipc.handle('accounts:logout', async (_e: unknown, id: string) => {
    const a = accounts.find((x) => x.id === id)
    if (!a) return snapshot()
    // A shared login logs out every account on it, so their popups go too.
    for (const x of onPartition(a, accounts)) popups.closeFor(x.id)
    appendEvent(dir, `logout ${id} (from the app)`)
    await logOut(dir, id, {
      clearStorage,
      closeView: () => {},
      reloadView: () => {
        const preset = presetFor(a.serviceId)
        void views.get(id)?.webContents.loadURL(preset?.startUrl ?? a.custom?.url ?? 'about:blank')
      }
    })
    return snapshot()
  })
  gipc.handle('accounts:remove', async (_e: unknown, id: string) => {
    if (!accounts.some((a) => a.id === id)) return snapshot()
    if (id === splitB) endSplit()
    popups.closeFor(id)
    const removedKey = accounts.find((a) => a.id === id) ? partitionKey(accounts.find((a) => a.id === id)!) : undefined
    try {
      appendEvent(dir, `remove account ${id} (from the app)`)
      await removeAccount(dir, id, {
        clearStorage,
        reloadView: () => {},
        closeView: () => {
          const v = views.get(id)
          if (!v) return
          if (attached === v) {
            detach(win, v)
            attached = undefined
            attachedId = undefined
          }
          owner.delete(v.webContents.id)
          views.delete(id)
          v.webContents.close()
        }
      })
    } catch (err) {
      console.error('remove account failed:', err)
    }
    accounts = orderedAccounts(loadAccounts(dir))
    if (removedKey && !accounts.some((a) => partitionKey(a) === removedKey)) saveProxyAuth(dir, removedKey, undefined)
    // The removed account's inbox rows go with it (D64).
    inbox = inbox.filter((i) => accounts.some((a) => a.id === i.accountId))
    saveInbox(dir, inbox)
    onInbox()
    delete counts[id]
    delete sleepState[id]
    blockState.forget(id)
    reconcile()
    push()
    pushSleep()
    return snapshot()
  })
  gipc.handle('accounts:zoom-reset', (_e: unknown, id: string) => {
    if (accounts.some((a) => a.id === id)) changeZoom(id, 0)
    return snapshot()
  })
  // Per-account proxy (D63): saved on the account, re-applied to its partition before the view reloads.
  const reloadProxyViews = (a: Account) => {
    for (const [id, v] of views) {
      const held = accounts.find((x) => x.id === id)
      if (!held || partitionKey(held) !== partitionKey(a) || v.webContents.isDestroyed()) continue
      v.webContents.reload()
    }
  }
  const applyProxyChange = async (a: Account, raw: string | undefined) => {
    const ses = session.fromPartition(partitionOf(a))
    await configureProxy(ses, raw)
    await ses.closeAllConnections().catch(() => {})
    reloadProxyViews(a)
  }
  /** Fetches the public address through the account's proxy session: proves the route end to end. */
  const testProxy = async (a: Account): Promise<{ ip: string } | { error: string }> => {
    const raw = effectiveProxy(a, accounts)
    const p = raw ? parseProxy(raw) : undefined
    if (!p || !p.ok) return { error: 'No proxy is set for this account.' }
    const ses = session.fromPartition(partitionOf(a))
    try {
      await configureProxy(ses, raw)
      const r = await ses.fetch('https://api.ipify.org', { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) return { error: `The proxy answered with HTTP ${r.status}.` }
      const ip = (await r.text()).trim().slice(0, 80)
      if (!ip) return { error: 'The proxy returned no address.' }
      appendEvent(dir, `proxy test ${a.id} ${proxyLabel(p.value)} -> ${ip}`)
      return { ip }
    } catch (err) {
      appendEvent(dir, `proxy test failed ${a.id} ${proxyLabel(p.value)}`)
      return { error: String((err as Error)?.message ?? err) }
    }
  }
  gipc.handle('accounts:proxy', async (_e: unknown, id: unknown, raw: unknown) => {
    if (typeof id !== 'string' || typeof raw !== 'string') return snapshot()
    const a = accounts.find((x) => x.id === id)
    if (!a) return snapshot()
    if (a.shareWith) return { error: 'This account follows the proxy of its shared login.' }
    const key = partitionKey(a)
    const text = raw.trim()
    if (!text) {
      accounts = orderedAccounts(setAccountProxy(dir, id, undefined))
      saveProxyAuth(dir, key, undefined)
      await applyProxyChange(a, undefined)
      appendEvent(dir, `proxy off ${id}`)
      return snapshot()
    }
    const p = parseProxy(text)
    if (!p.ok) return { error: p.error }
    const rules = proxyRules(p.value)
    const entered = p.value.username ? { username: p.value.username, password: p.value.password ?? '' } : undefined
    const previous = loadProxyAuth(dir)[key]
    const old = a.proxy ? parseProxy(a.proxy) : undefined
    // A new address without a sign-in keeps the old one only when it is still the same proxy.
    const keep = entered ?? (previous && old?.ok && sameProxy(old.value, p.value) ? previous : undefined)
    accounts = orderedAccounts(setAccountProxy(dir, id, rules))
    saveProxyAuth(dir, key, keep)
    await applyProxyChange(a, rules)
    appendEvent(dir, `proxy set ${id} ${proxyLabel(p.value)}${keep ? ' with sign-in' : ''}`)
    return snapshot()
  })
  gipc.handle('proxy:test', (e: { sender: { id: number } }, id: unknown) => {
    const a = fromApp(e) && typeof id === 'string' ? accounts.find((x) => x.id === id) : undefined
    return a ? testProxy(a) : { error: 'Unknown account.' }
  })
  // Proxy chip: a native menu (it draws above the page) with the address, a real connection test and Change.
  gipc.on('proxy:menu', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && accounts.find((x) => x.id === id)
    if (!a) return
    const raw = effectiveProxy(a, accounts)
    const p = raw ? parseProxy(raw) : undefined
    const showTest = async () => {
      const r = await testProxy(a)
      if (!Notification.isSupported()) return
      const n = 'ip' in r
        ? new Notification({ title: 'Proxy connection works', body: `Your IP: ${r.ip}` })
        : new Notification({ title: 'Proxy connection failed', body: r.error })
      live.add(n)
      n.on('close', () => live.delete(n))
      n.show()
    }
    Menu.buildFromTemplate(
      proxyMenu(p?.ok ? p.value : undefined).map((i) => {
        if (i.separator) return { type: 'separator' as const }
        const item: Electron.MenuItemConstructorOptions = { label: i.label, enabled: i.enabled }
        if (i.action === 'test') item.click = () => void showTest()
        if (i.action === 'change') item.click = () => {
          showWindow()
          if (isUnlocked() && !win.isDestroyed()) win.webContents.send('ui:sheet', a.id)
        }
        return item
      })
    ).popup({ window: win })
  })
  gipc.on('sidebar:hidden', (e: { sender: { id: number } }, h: unknown) => {
    if (!fromApp(e)) return
    sidebarHidden = !!h
    saveSidebarLayout(dir, { width: sidebarWidth, hidden: sidebarHidden })
    pushLayout()
  })
  gipc.on('sidebar:width', (e: { sender: { id: number } }, w: unknown) => {
    if (!fromApp(e)) return
    sidebarWidth = clampSide(w)
    saveSidebarLayout(dir, { width: sidebarWidth, hidden: sidebarHidden })
    pushLayout()
  })
  gipc.on('sidebar:set', (e: { sender: { id: number } }, c: unknown) => fromApp(e) && setSidebar(!!c))
  // Reload (top bar): an asleep account wakes through the normal show path, otherwise its view reloads.
  gipc.on('accounts:reload', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && enabled().find((x) => x.id === id)
    if (!a) return
    if (hib.isAsleep(a.id)) show(win, a, pushSleep)
    else views.get(a.id)?.webContents.reload()
  })
  // Sleep now (D27): works on any account; minutes 0 marks it manual. The selected one is detached so the asleep panel shows.
  gipc.on('accounts:sleep', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && enabled().find((x) => x.id === id)
    if (!a || hib.isAsleep(a.id)) return
    if (attachedId === a.id || id === splitB) endSplit()
    if (attachedId === a.id && attached) {
      detach(win, attached)
      attached = undefined
      attachedId = undefined
    }
    hib.sleep(a.id)
    sleepAccount(a, 0)
    pushSleep()
  })
  // Row menu (D41): native so it draws over the service view; the pick goes back to the sidebar.
  gipc.on('sidebar:menu', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && enabled().find((x) => x.id === id)
    if (!a) return
    Menu.buildFromTemplate(
      rowMenuItems({ muted: !!a.muted, asleep: hib.isAsleep(a.id) }).map((i) => ({
        label: i.label,
        click: () => win.webContents.send('sidebar:menu-pick', { id: a.id, action: i.action })
      }))
    ).popup({ window: win })
  })
  // Links to another service (D40): none -> browser, one -> popup, several -> the renderer's chooser (one pending at a time).
  let pending: { id: number; url: string; ids: string[] } | undefined
  let choiceSeq = 0
  const offer = (url: string, c: Account[]) => {
    const safe = safeWebUrl(url)
    if (!safe) return
    if (c.length === 1) return openPopup(c[0], safe)
    pending = { id: ++choiceSeq, url: safe, ids: c.map((a) => a.id) }
    showWindow()
    win.webContents.send('links:choose', {
      id: pending.id,
      url: safe,
      candidates: c.map((a) => ({ id: a.id, label: a.label, colour: a.colour, serviceId: a.serviceId }))
    })
  }
  openOut = (url) => {
    const c = isUnlocked() ? candidatesFor(url, accounts, [...disabled]) : []
    if (!c.length) return void shell.openExternal(url)
    offer(url, c)
  }
  siblingsOf = (a) => siblingsFor(a, accounts, [...disabled])
  openIn = (url, c) => {
    const safe = safeWebUrl(url)
    if (isUnlocked() && safe && c.length) offer(safe, c)
  }
  gipc.on('links:chosen', (e: { sender: { id: number } }, id: unknown, choice: unknown) => {
    const p = pending
    if (!fromApp(e) || !p || id !== p.id) return
    pending = undefined
    if (choice === 'browser') void shell.openExternal(p.url)
    else if (typeof choice === 'string' && p.ids.includes(choice)) {
      const a = enabled().find((x) => x.id === choice)
      if (a) openPopup(a, p.url)
    }
  })
  gipc.on('ui:dialog', (_e: unknown, open: boolean) => setDialog(win, !!open))
  // Split view (D62): a native menu picks the second account; ratio updates resize both pages live and save on release.
  gipc.on('split:menu', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && enabled().find((x) => x.id === id)
    if (!a) return
    const others = enabled().filter((x) => x.id !== a.id)
    const items: Electron.MenuItemConstructorOptions[] = others.length
      ? others.map((x) => ({
          label: `${x.label} · ${presetFor(x.serviceId)?.name ?? x.custom?.name ?? x.serviceId}`,
          type: 'checkbox' as const,
          checked: splitB === x.id,
          click: () => startSplit(x.id)
        }))
      : [{ label: 'No other account', enabled: false }]
    if (splitB) items.push({ type: 'separator' as const }, { label: 'Close split', click: closeSplit })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  gipc.on('split:close', (e: { sender: { id: number } }) => {
    if (fromApp(e)) closeSplit()
  })
  gipc.on('split:ratio', (e: { sender: { id: number } }, r: unknown) => {
    if (!fromApp(e) || !second) return
    splitRatio = clampSplit(r)
    layoutViews(win)
  })
  gipc.on('split:ratio-end', (e: { sender: { id: number } }, r: unknown) => {
    if (!fromApp(e) || !second || !attachedId || !splitB) return
    splitRatio = clampSplit(r)
    layoutViews(win)
    saveSplit(dir, { a: attachedId, b: splitB, ratio: splitRatio })
    onSplitChange()
  })
  gipc.handle('accounts:mute', (_e: unknown, id: string, muted: boolean) => {
    if (!accounts.some((a) => a.id === id)) return snapshot()
    accounts = orderedAccounts(setMuted(dir, id, !!muted))
    // The notification path reads the Account captured when the view was built: keep it current.
    const held = owner.get(views.get(id)?.webContents.id ?? -1)
    if (held) held.muted = !!muted
    // A muted account's inbox items stay, but no longer count as unread (D64).
    onInbox()
    return snapshot()
  })
  gipc.handle('accounts:blur', (_e: unknown, id: string, on: boolean) => {
    if (!accounts.some((a) => a.id === id)) return snapshot()
    accounts = orderedAccounts(setBlurMedia(dir, id, !!on))
    const v = views.get(id)
    const held = owner.get(v?.webContents.id ?? -1)
    if (held) held.blurMedia = !!on
    if (v && !v.webContents.isDestroyed()) v.webContents.send('blur:set', blurState(held ?? accounts.find((a) => a.id === id)))
    return snapshot()
  })
  gipc.handle('accounts:blurpart', (_e: unknown, id: string, part: string, on: boolean) => {
    if (!accounts.some((a) => a.id === id) || !(PARTS as readonly string[]).includes(part)) return snapshot()
    accounts = orderedAccounts(setBlurPart(dir, id, part as Part, !!on))
    const v = views.get(id)
    const held = owner.get(v?.webContents.id ?? -1)
    if (held) held.blurParts = accounts.find((a) => a.id === id)?.blurParts
    if (v && !v.webContents.isDestroyed()) v.webContents.send('blur:set', blurState(accounts.find((a) => a.id === id)))
    return snapshot()
  })
  // Chrome extension switch (D49): saved, then loaded or unloaded in the live session and WhatsApp reloads.
  onExtChange = () => { if (!win.isDestroyed() && isUnlocked()) win.webContents.send('accounts:zoom', snapshot()) }
  const extList = () => {
    const times = loadUpdateTimes(dir)
    return listInstalled(extensionsDir(dir)).map(({ id, name, version }) => ({ id, name, version, ...(times[id] ? { updated: times[id] } : {}) }))
  }
  gipc.handle('ext:list', (e: { sender: { id: number } }) => (fromApp(e) ? extList() : []))
  // Weekly auto-update (D56) plus the Settings > Extensions button. The first check runs shortly after start.
  setTimeout(() => void updateExtensions(), 60_000).unref()
  setInterval(() => void updateExtensions(), 7 * 24 * 3600_000).unref()
  gipc.handle('ext:update-check', (e: { sender: { id: number } }) => (fromApp(e) ? updateExtensions() : { checked: 0, updated: [] }))
  // Add from a Chrome Web Store link (or id): downloaded once, then off for every account until turned on.
  gipc.handle('ext:install', async (e: { sender: { id: number } }, link: string) => {
    if (!fromApp(e)) return { error: 'Refused' }
    const id = parseExtensionId(link)
    if (!id) return { error: 'Paste a Chrome Web Store link, like https://chromewebstore.google.com/detail/name/<id>' }
    try {
      await fetchExtension(id)
      const times = loadUpdateTimes(dir)
      times[id] = day()
      saveUpdateTimes(dir, times)
      appendEvent(dir, `extension installed ${id}`)
      return { ok: true, list: extList() }
    } catch (err) {
      return { error: `Could not download it: ${String((err as Error)?.message ?? err)}` }
    }
  })
  gipc.handle('ext:remove', async (e: { sender: { id: number } }, id: string) => {
    if (!fromApp(e) || typeof id !== 'string' || !/^[a-p]{32}$/.test(id)) return extList()
    for (const a of accounts) if (a.extensions?.includes(id)) accounts = orderedAccounts(setExtensions(dir, a.id, toggled(a.extensions, id, false)))
    for (const [aid, v] of views) {
      if (v.webContents.isDestroyed()) continue
      const sx = v.webContents.session.extensions
      if (sx.getExtension(id)) { sx.removeExtension(id); v.webContents.reload() }
      const held = owner.get(v.webContents.id)
      if (held) held.extensions = accounts.find((x) => x.id === aid)?.extensions
    }
    rmSync(join(extensionsDir(dir), id), { recursive: true, force: true })
    appendEvent(dir, `extension removed ${id}`)
    onExtChange()
    return extList()
  })
  // On or off for one account: saved, loaded or unloaded in the live session, and the page reloads.
  const setAccountExtension = async (id: string, extId: string, on: boolean) => {
    const a0 = accounts.find((a) => a.id === id)
    if (!a0 || !installedIds().includes(extId)) return
    accounts = orderedAccounts(setExtensions(dir, id, toggled(a0.extensions, extId, on)))
    const v = views.get(id)
    const held = owner.get(v?.webContents.id ?? -1)
    const a = accounts.find((x) => x.id === id)!
    if (held) held.extensions = a.extensions
    if (v && !v.webContents.isDestroyed()) {
      await applyExtensions(held ?? a, v.webContents, win)
      v.webContents.reload()
    }
  }
  gipc.handle('accounts:extension', async (_e: unknown, id: string, extId: string, on: boolean) => {
    if (typeof extId === 'string') await setAccountExtension(id, extId, !!on)
    return snapshot()
  })
  // Puzzle button in the top bar: a native menu (it draws above the page) with every installed extension.
  gipc.on('ext:menu', (e: { sender: { id: number } }, id: string) => {
    const a = fromApp(e) && accounts.find((x) => x.id === id)
    if (!a) return
    const v = views.get(a.id)
    const list = extList()
    const on = new Set(a.extensions ?? [])
    const items: Electron.MenuItemConstructorOptions[] = list.length
      ? list.flatMap((x) => [
          { label: x.name, enabled: on.has(x.id) && !!v, click: () => v && activateExtension(v.webContents, x.id, win) },
          { label: `On for ${a.label}`, type: 'checkbox' as const, checked: on.has(x.id), click: () => void setAccountExtension(a.id, x.id, !on.has(x.id)).then(onExtChange) },
          { type: 'separator' as const }
        ])
      : [{ label: 'No extensions yet', enabled: false }, { type: 'separator' as const }]
    items.push({ label: 'Add or manage extensions...', click: () => win.webContents.send('settings:open-tab', 'Extensions') })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  gipc.handle('accounts:keepdeleted', (_e: unknown, id: string, on: boolean) => {
    if (!accounts.some((a) => a.id === id)) return snapshot()
    accounts = orderedAccounts(setKeepDeleted(dir, id, !!on))
    const v = views.get(id)
    const held = owner.get(v?.webContents.id ?? -1)
    if (held) held.keepDeleted = !!on
    keeperDown.delete(id)
    // The script is injected at page load, so a change takes effect with a reload.
    if (v && !v.webContents.isDestroyed()) v.webContents.reload()
    return snapshot()
  })
  gipc.handle('accounts:add', async (_e: unknown, input: any) => {
    const v = validateNewAccount(input)
    if (!v.ok) return { error: v.error }
    const icon = v.value.custom ? await cacheFavicon(dir, v.value.custom.url, fetchSite) : undefined
    let account: Account
    try {
      account = addAccount(dir, input, icon)
    } catch (err) {
      return { error: (err as Error).message }
    }
    accounts = orderedAccounts(loadAccounts(dir))
    selectedId = account.id
    saveSelected(dir, account.id)
    show(win, account, pushSleep)
    return snapshot()
  })
  // Only the app window may change the selected account; a popup or service view is ignored (like every other state channel).
  gipc.on('accounts:select', appOnly(fromApp, (id: string) => {
    const a = enabled().find((x) => x.id === id)
    if (!a) return
    selectedId = id
    saveSelected(dir, id)
    show(win, a, pushSleep)
  }))
  // Keyboard switching (D33): same path as a click (wakes an asleep account); the renderer follows through accounts:selected.
  // Not while locked or with a dialog/Settings open (dialogOpen covers both).
  switchKeyDown = (input) => {
    if (!isUnlocked() || dialogOpen) return false
    const id = switchTarget(input, sidebarOrder(enabled()).map((a) => a.id), selectedId)
    const a = id ? enabled().find((x) => x.id === id) : undefined
    if (!a) return false
    selectedId = a.id
    saveSelected(dir, a.id)
    show(win, a, pushSleep)
    win.webContents.send('accounts:selected', a.id)
    return true
  }
  const selectFromNotification = (a: Account) => {
    win.show()
    win.focus()
    if (!isUnlocked() || disabled.has(a.serviceId)) return // a click while locked only raises the window
    selectedId = a.id
    saveSelected(dir, a.id)
    show(win, a, pushSleep)
    win.webContents.send('accounts:selected', a.id)
  }
  ipcMain.removeAllListeners('notify:show')
  ipcMain.on('notify:show', (e, p) => {
    const a = owner.get(e.sender.id)
    if (a && p && typeof p === 'object') notify(win, a, p, () => selectFromNotification(a))
  })
  // Dev-only: GUISEDESK_FAKE_NOTIFY=<account id> fires one fake notification 4 s after load.
  const fake = accounts.find((a) => a.id === process.env.GUISEDESK_FAKE_NOTIFY)
  if (fake)
    win.webContents.once('did-finish-load', () =>
      setTimeout(() => notify(win, fake, { title: 'Alice', body: 'Lunch at 12?' }, () => selectFromNotification(fake)), 4000)
    )
  const first = accounts.find((a) => a.id === selectedId)
  if (first && !hib.isAsleep(first.id)) {
    show(win, first, pushSleep)
    if (restorableSplit && restorableSplit.a === first.id) restoreSplit(restorableSplit)
  } else if (savedSplit) saveSplit(dir, undefined)
  win.on('resize', () => layoutViews(win))
  win.on('focus', () => {
    focusedId = attachedId
  })

  const shot = process.env.GUISEDESK_SHOT
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          // Service views are separate surfaces: paste the selected one into the content panel, and save it raw next to it.
          if (attached && !dialogOpen && isUnlocked()) {
            const v = await attached.webContents.capturePage()
            writeFileSync(shot.replace(/\.png$/, '') + '-view.png', v.toPNG())
            const b = attached.getBounds()
            const sw = image.getSize()
            const k = sw.width / win.getContentSize()[0]
            // HiDPI: the window capture is k times the DIP size; bring the view capture to the same scale before pasting.
            const tw = Math.round(b.width * k)
            const th = Math.round(b.height * k)
            const scaled = v.getSize().width === tw ? v : v.resize({ width: tw, height: th, quality: 'best' })
            const vs = scaled.getSize()
            const c = overlay(
              { ...sw, data: image.toBitmap() },
              { ...vs, data: scaled.toBitmap() },
              Math.round(b.x * k),
              Math.round(b.y * k)
            )
            writeFileSync(shot, nativeImage.createFromBitmap(c.data, { width: c.width, height: c.height }).toPNG())
          } else writeFileSync(shot, image.toPNG())
        } finally {
          app.quit()
        }
      }, 3000)
    })
  }
  return win
}

app.whenReady().then(() => {
  appendEvent(dir, `start v${version} electron ${process.versions.electron}`)
  createWindow()
  // A restored backup lists extension ids, not their files: download them again in the background (D61).
  for (const id of restoredExtensions) {
    void fetchExtension(id, true)
      .then(() => appendEvent(dir, `extension restored ${id}`))
      .catch((err) => appendEvent(dir, `extension restore failed ${id} ${String((err as Error)?.message ?? err)}`))
  }
  scheduleLoginCheck(15_000)
})

/** Reads WhatsApp's QR/side markers from a loaded view; undefined when the view is gone or did not answer. */
async function whatsappPage(wc: Electron.WebContents): Promise<WaPage | undefined> {
  try {
    if (wc.isDestroyed()) return undefined
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t)
          wc.removeListener('did-finish-load', done)
          wc.removeListener('did-fail-load', done)
          resolve()
        }
        const t = setTimeout(done, 5000)
        wc.once('did-finish-load', done)
        wc.once('did-fail-load', done)
      })
    }
    // Give the page script time to replace the QR screen with the chat panel (debounce).
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (wc.isDestroyed()) return undefined
    return parseWaPage(await wc.executeJavaScript(WA_PAGE_SCRIPT, true))
  } catch {
    return undefined
  }
}

/** One login check at a time: a load and the start timer can both ask, and the file must not be written twice at once. */
let loginCheckQueue: Promise<void> = Promise.resolve()
function scheduleLoginCheck(delay: number): void {
  setTimeout(() => {
    loginCheckQueue = loginCheckQueue.then(checkLogins).catch(() => {})
  }, delay).unref()
}

/**
 * Lost-login check (D50): compares each account's login with the last start and logs any that vanished. Services
 * use their login cookie; WhatsApp uses its IndexedDB store and, for a loaded view, the QR screen versus #side.
 */
async function checkLogins(): Promise<void> {
  try {
    const file = join(dir, 'logins.json')
    let prev: Record<string, boolean> = {}
    try { prev = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first run */ }
    const accounts = loadAccounts(dir)
    const now: Record<string, boolean> = {}
    for (const a of accounts) {
      if (a.serviceId === 'whatsapp') {
        const store = storeHasData(readDirSafe(waStorePath(dir, partitionKey(a))))
        const v = views.get(a.id)
        const page = v && !v.webContents.isDestroyed() ? await whatsappPage(v.webContents) : undefined
        const state = whatsappLoggedIn(store, page)
        if (state !== undefined) now[a.id] = state
        continue
      }
      const rule = LOGIN_COOKIES[a.serviceId]
      if (!rule?.names.length) continue
      const ses = session.fromPartition(partitionOf(a))
      const cookies = await ses.cookies.get({ domain: rule.domain })
      now[a.id] = rule.names.every((n) => cookies.some((c) => c.name === n))
    }
    for (const id of lostLogins(prev, now)) {
      const a = accounts.find((x) => x.id === id)
      const why = a?.serviceId === 'whatsapp' ? 'login data or session gone since last start' : 'login cookie gone since last start'
      appendEvent(dir, `lost login ${a?.serviceId} "${a?.label}" (${id}): ${why}`)
    }
    writeAtomic(file, JSON.stringify(now))
  } catch (err) {
    appendEvent(dir, `login check failed ${String(err)}`)
  }
}
app.on('before-quit', () => {
  quitting = true
  appendEvent(dir, 'quit')
  // Write cookies and storage to disk before exit, so a quit or update right after a login keeps it.
  for (const v of views.values()) {
    if (v.webContents.isDestroyed()) continue
    void v.webContents.session.cookies.flushStore().catch(() => {})
    v.webContents.session.flushStorageData()
  }
})
// Session end (logout/shutdown) and kill: same flush, then exit.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sig, () => {
  appendEvent(dir, `signal ${sig}`)
  app.quit()
})
