declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** A preload `on*` helper returns the function that removes its listener (when the bridge provides one). */
type Unsubscribe = void | (() => void)

interface LinkChoice {
  id: number
  url: string
  candidates: { id: string; label: string; colour: string; serviceId: string }[]
}

/** One finished download in Settings > General (UX-009). */
interface DownloadEntryRow {
  path: string
  name: string
  time: number
  ok: boolean
}

interface AccountRow {
  id: string
  serviceId: string
  label: string
  colour: string
  order: number
  muted?: boolean
  blurMedia?: boolean
  blurParts?: Partial<Record<'messages' | 'previews' | 'avatars' | 'names', boolean>>
  keepDeleted?: boolean
  /** Chrome extension ids on for this account (D49). */
  extensions?: string[]
  extError?: string
  keeperUnavailable?: boolean
  zoom?: number
  idlePolicy?: string
  shareWith?: string
  /** Proxy address in effect for this account (D63), without credentials. A shared login shows its host's proxy. */
  proxy?: string
  /** Proxy sign-in user saved for this account's partition (D63); the password never leaves main. */
  proxyUser?: string
  custom?: { name: string; url: string; icon?: string }
}

interface BlockSnapshot {
  ads: boolean
  accounts: Record<string, { blocked: number; popup?: string; total?: number; popups?: number; hosts?: Record<string, number> }>
}

interface LockScheduleRow {
  on: boolean
  days: number[]
  start: string
  end: string
  workMinutes: number
  offMinutes: number
  count: 'unlock' | 'idle'
}

interface ExtensionRow {
  id: string
  name: string
  version: string
  /** Last update or install date (YYYY-MM-DD), shown in Settings > Extensions (D56). */
  updated?: string
}

interface ExtensionUpdateResult {
  checked: number
  updated: { id: string; version: string }[]
}

/** What an exported backup holds (D61). The restore dialog shows these details before replacing anything. */
interface BackupManifest {
  app: 'guisedesk'
  format: number
  created: string
  version: string
  includeLogins: boolean
  accounts: number
  settings: boolean
  lock: boolean
  extensions: string[]
  files: number
  bytes: number
}

/** One stored notification (D64). Locked items have a generic title and no body. */
interface InboxItem {
  id: string
  accountId: string
  title: string
  body: string
  time: number
  read: boolean
}

interface InboxSnapshot {
  items: InboxItem[]
  /** Unread items excluding muted accounts. */
  unread: number
}

interface Snapshot {
  accounts: AccountRow[]
  selectedId?: string
  /** Service ids switched off in Settings: their accounts are hidden from the sidebar. */
  disabledServices: string[]
  /** Sidebar shown as the 64px rail (D24). */
  sidebarCollapsed?: boolean
  sidebarHidden?: boolean
  sidebarWidth?: number
  /** Split view (D62): the second account and the divider position. Missing means no split. */
  split?: { b: string; ratio: number }
}

interface LockInfo {
  state: 'setup' | 'locked' | 'unlocked'
  kind?: 'pin' | 'password'
  pinLength?: number
  waitUntil?: number
}

/** Update status (D29). 'checking' is the state before the first check finishes. */
interface UpdateInfo {
  state: 'checking' | 'disabled' | 'none' | 'available' | 'error'
  latest?: string
  message?: string
  /** Local commits on top of a release tag (D55): updates are off for this build. */
  custom?: { tag: string; count: number }
}

interface Window {
  guisedesk: {
    /** Lock state from main (the source of truth). Account data is only available while 'unlocked'. */
    lockState(): Promise<LockInfo>
    onLock(cb: (info: LockInfo) => void): Unsubscribe
    /** The entry goes to main once and is checked there; the answer is ok, wrong or a wait. */
    unlock(entry: string): Promise<{ result: 'ok' } | { result: 'wrong' } | { result: 'wait'; until: number }>
    setupLock(kind: 'pin' | 'password', secret: string, repeat: string): Promise<{ ok: true } | { error: string }>
    lock(): void
    /** Settings that act at once: idle lock minutes, Do Not Disturb, start on login (autostart entry present). */
    /** Lock schedule (D51): work-hours and off-hours lock limits. setSchedule returns the saved (normalized) value. */
    schedule(): Promise<LockScheduleRow>
    setSchedule(s: LockScheduleRow): Promise<LockScheduleRow>
    prefs(): Promise<{ idleLock: 5 | 10 | 30 | 'manual'; dnd: boolean; quietWorkHours: boolean; startOnLogin: boolean }>
    /** Settings reopens on the last tab used (UX-006); missing means Services. */
    lastSettingsTab(): Promise<string | undefined>
    saveLastSettingsTab(tab: string): Promise<boolean>
    setIdle(minutes: 5 | 10 | 30 | 'manual'): Promise<boolean>
    /** The lock countdown (D57): time left under the active rule, or null when only manual locking applies. */
    lockCountdown(): Promise<{ ms: number; rule: string } | null>
    onLockCountdown(cb: (c: { ms: number; rule: string } | null) => void): Unsubscribe
    /** The countdown chip: main shows a native menu (rule, add 15 minutes, lock now, lock settings). */
    lockMenu(): void
    setDnd(on: boolean): Promise<boolean>
    /** The tray checkbox changed Do Not Disturb. */
    onDnd(cb: (on: boolean) => void): Unsubscribe
    /** Quiet outside work hours (D58), separate from the tray DND switch. */
    setQuietWorkHours(on: boolean): Promise<boolean>
    /** The Settings switch changed quiet hours (UX-049). */
    onQuiet(cb: (on: boolean) => void): Unsubscribe
    setStartOnLogin(on: boolean): Promise<boolean>
    /** Needs the current PIN or password; main applies the setup rules to the new one. */
    changeLock(current: string, kind: 'pin' | 'password', secret: string, repeat: string): Promise<{ ok: true } | { error: string; waitUntil?: number }>
    /** Wipes every account and session, after RESET is typed; main re-checks the word. */
    reset(typed: string): Promise<{ ok: true } | { error: string }>
    state(): Promise<Snapshot>
    unread(): Promise<Record<string, number>>
    onUnread(cb: (counts: Record<string, number>) => void): Unsubscribe
    /** Notifications inbox (D64): newest first, kept in main; muted accounts are kept but not counted. */
    inbox(): Promise<InboxSnapshot>
    inboxRead(id: string): Promise<InboxSnapshot>
    /** Mark a read item unread again (UX-022); the dialog stays open. */
    inboxUnread(id: string): Promise<InboxSnapshot>
    inboxReadAll(): Promise<InboxSnapshot>
    inboxClear(): Promise<InboxSnapshot>
    onInbox(cb: (s: InboxSnapshot) => void): Unsubscribe
    select(id: string): void
    sleep(): Promise<Record<string, { minutes: number; waking: boolean }>>
    onSleep(cb: (s: Record<string, { minutes: number; waking: boolean }>) => void): Unsubscribe
    /** Main selected an account (notification click). */
    onSelected(cb: (id: string) => void): Unsubscribe
    /** Collapse or expand the sidebar; main saves it and resizes the service view. */
    setSidebar(collapsed: boolean): void
    /** Main changed the sidebar (Ctrl+B). */
    onSidebar(cb: (collapsed: boolean) => void): Unsubscribe
    /** Hide the sidebar completely, or set its full width by dragging (D52). Main resizes the page and pushes the layout. */
    setSidebarHidden(hidden: boolean): void
    setSidebarWidth(width: number): void
    onSidebarLayout(cb: (l: { collapsed: boolean; hidden: boolean; width: number }) => void): Unsubscribe
    /** Split view (D62): main shows a native menu of the other accounts, closes it, or resizes both pages. */
    splitMenu(id: string): void
    closeSplit(): void
    setSplitRatio(ratio: number): void
    saveSplitRatio(ratio: number): void
    onSplit(cb: (s: { b: string; ratio: number } | undefined) => void): Unsubscribe
    /** Dialog open: main detaches the service view so the dialog is not hidden behind it. */
    dialog(open: boolean): void
    /** Ctrl+K (D59): main asks for the quick switcher, from the window or a service view. */
    onSwitcher(cb: () => void): Unsubscribe
    /** F1 (D60): main asks for the shortcut cheat sheet. */
    onShortcuts(cb: () => void): Unsubscribe
    /** Top bar Reload: reloads the account's view, or wakes it when asleep. */
    reload(id: string): void
    /** Top bar Home (UX-014): loads the service start page, or a custom site's URL. */
    home(id: string): void
    /** Top bar Back and Forward (UX-013): move in the account page's history. */
    back(id: string): void
    forward(id: string): void
    onNavState(cb: (s: { id: string; canBack: boolean; canForward: boolean }) => void): Unsubscribe
    /** The account page started or stopped loading (UX-046); the bar is debounced and cleared at 30 s. */
    onLoading(cb: (p: { id: string; loading: boolean }) => void): Unsubscribe
    /** Retry card (UX-010): opens the account's start page in the system browser. */
    openSite(id: string): void
    /** A main-frame page load failed, or a later load cleared the retry card. */
    onPageError(cb: (p: { id: string; code?: number; description?: string; cleared?: boolean }) => void): Unsubscribe
    /** Sleep now (D27): unloads the account's view; it wakes on Wake up, Reload or reselect. */
    sleepNow(id: string): void
    /** Sidebar row menu (D41): main pops up a native menu; the pick comes back through onRowMenuPick. */
    rowMenu(id: string): void
    onRowMenuPick(cb: (p: { id: string; action: string }) => void): Unsubscribe
    /** Drag reorder (D28): full id list in the new order. */
    reorder(ids: string[]): Promise<Snapshot>
    /** Reset the shown account's zoom to 100% (D32). */
    resetZoom(id: string): Promise<Snapshot>
    /** Main changed a zoom level with the keyboard: the fresh snapshot. */
    onZoom(cb: (s: Snapshot) => void): Unsubscribe
    /** Mute or unmute an account (D19). */
    mute(id: string, muted: boolean): Promise<Snapshot>
    /** Per-account proxy (D63): empty value is Direct; an invalid address comes back as an error. */
    setProxy(id: string, value: string): Promise<Snapshot | { error: string }>
    /** Proxy chip: main shows the address, Test connection and Change (opens the account sheet). */
    proxyMenu(id: string): void
    /** Fetches the public IP through the account's proxy session. */
    testProxy(id: string): Promise<{ ip: string } | { error: string }>
    /** Main asks for the account sheet (the proxy menu's Change). */
    onOpenSheet(cb: (id: string) => void): Unsubscribe
    /** Blur media in an account's view until hovered (D42, D43). */
    setBlur(id: string, on: boolean): Promise<Snapshot>
    /** One WhatsApp privacy blur part on or off (D48). */
    setBlurPart(id: string, part: string, on: boolean): Promise<Snapshot>
    setKeepDeleted(id: string, on: boolean): Promise<Snapshot>
    /** Turn a known Chrome extension on or off for one account (D49); WhatsApp reloads. */
    setExtension(id: string, extId: string, on: boolean): Promise<Snapshot>
    /** Installed Chrome extensions (D49), install from a store link, remove (off for every account). */
    extensions(): Promise<ExtensionRow[]>
    /** Check the Chrome Web Store for newer copies and load them (D56). */
    checkExtensionUpdates(): Promise<ExtensionUpdateResult>
    installExtension(link: string): Promise<{ ok: true; list: ExtensionRow[] } | { error: string }>
    removeExtension(id: string): Promise<ExtensionRow[]>
    /** Puzzle button: main shows the extensions menu for this account. */
    extensionMenu(id: string): void
    /** An external link matches several accounts (D40): pick one, 'browser', or null to cancel. */
    onLinkChoose(cb: (r: LinkChoice) => void): Unsubscribe
    chooseLink(id: number, choice: string | null): void
    /** Settings was opened from the tray. */
    onOpenSettings(cb: () => void): Unsubscribe
    /** Switch a whole service on or off (D6); sessions stay. */
    setServiceEnabled(serviceId: string, enabled: boolean): Promise<Snapshot>
    /** Hibernation override for one account (D7): default | always | 10 | 30 | 60. */
    setPolicy(id: string, policy: string): Promise<Snapshot>
    /** Clears the account's saved login; the account stays. */
    logout(id: string): Promise<Snapshot>
    /** Deletes the account and its saved data. */
    remove(id: string): Promise<Snapshot>
    /** Update status from main, a manual check, applying the update (copies update.sh, spawns it, quits), and pushes (D29). */
    updateState(): Promise<UpdateInfo>
    updateCheck(): Promise<UpdateInfo>
    updateApply(): Promise<boolean>
    onUpdate(cb: (u: UpdateInfo) => void): Unsubscribe
    /** Backup and restore (D61): export writes one encrypted file; a restore is staged for the next start. */
    exportBackup(v: { password: string; includeLogins: boolean }): Promise<{ ok: true; file: string; manifest?: BackupManifest } | { canceled: true } | { error: string }>
    pickBackup(): Promise<{ file: string } | { canceled: true }>
    inspectBackup(v: { file: string; password: string }): Promise<{ manifest: BackupManifest } | { error: string }>
    restoreBackup(v: { file: string; password: string }): Promise<{ ok: true; manifest: BackupManifest } | { error: string }>
    /** Settings > General "About and data" (UX-007): open the data folder or show events.log. */
    openDataFolder(): Promise<boolean>
    showEventLog(): Promise<boolean>
    /** Settings > General Quit (UX-031): really quits; closing the window only hides it to the tray. */
    quit(): Promise<boolean>
    /** Downloads (D31): the folder in use (the system Downloads dir by default) and the ask switch; pick opens a folder picker and saves it. */
    downloads(): Promise<{ dir: string; ask: boolean }>
    setDownloadsAsk(ask: boolean): Promise<boolean>
    pickDownloadsDir(): Promise<string | undefined>
    /** Open the downloads folder (UX-008): empty on success, or the error to show on the card. */
    openDownloadsFolder(): Promise<string>
    /** Recent downloads (UX-009): the last 20 finished files, clearing the list, and showing one in its folder. */
    downloadsList(): Promise<DownloadEntryRow[]>
    clearDownloads(): Promise<DownloadEntryRow[]>
    showDownload(path: string): Promise<boolean>
    /** Ad and pop-up blocking (D45): both on by default; setBlocking saves and applies (ads reload the open views). */
    blocking(): Promise<{ ads: boolean; popups: boolean }>
    setBlocking(v: { ads?: boolean; popups?: boolean }): Promise<boolean>
    /** Top bar chips (D45): blocked requests per account since the view loaded, and the last dropped pop-up. */
    blockState(): Promise<BlockSnapshot>
    onBlock(cb: (s: BlockSnapshot) => void): Unsubscribe
    /** "Open anyway" on the Pop-up blocked chip: opens the dropped URL with the normal window.open handling. */
    openBlockedPopup(id: string): Promise<boolean>
    /** Shield chip click: main shows the stats menu. */
    shieldMenu(id: string): void
    /** Main asks for a Settings tab (the shield menu's Blocking settings). */
    onOpenSettingsTab(cb: (tab: string) => void): Unsubscribe
    add(input: {
      serviceId: string
      label: string
      colour: string
      shareWith?: string
      custom?: { name: string; url: string }
    }): Promise<Snapshot | { error: string }>
    /** Rename and recolour an existing account (UX-016). */
    edit(input: { id: string; label: string; colour: string }): Promise<Snapshot>
  }
}
