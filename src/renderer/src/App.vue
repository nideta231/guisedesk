<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AddAccount from './AddAccount.vue'
import AccountSheet from './AccountSheet.vue'
import AsleepPanel from './AsleepPanel.vue'
import BrandMark from './BrandMark.vue'
import Inbox from './Inbox.vue'
import LinkChooser from './LinkChooser.vue'
import LockScreen from './LockScreen.vue'
import QuickSwitcher from './QuickSwitcher.vue'
import ResetScreen from './ResetScreen.vue'
import Settings from './Settings.vue'
import ShortcutHelp from './ShortcutHelp.vue'
import SetupScreen from './SetupScreen.vue'
import Sidebar from './Sidebar.vue'
import SplitDivider from './SplitDivider.vue'
import TopBar from './TopBar.vue'
import { visibleAccounts } from '../../main/services'
import { formatCount } from '../../main/unread'

const accounts = ref<AccountRow[]>([])
const selectedId = ref<string | undefined>()
const counts = ref<Record<string, number>>({})
// Accounts whose view is destroyed (asleep) or being rebuilt (waking): minutes = the limit that put them to sleep.
const sleep = ref<Record<string, { minutes: number; waking: boolean }>>({})
const asleepIds = computed(() => Object.keys(sleep.value).filter((id) => !sleep.value[id].waking))
const sleeping = computed(() => accounts.value.find((a) => a.id === selectedId.value && sleep.value[a.id]))
// Services switched off in Settings (D6): their accounts stay in `accounts` (and in the store) but leave the sidebar.
const disabled = ref<string[]>([])
// Sidebar rail (D24): main owns and saves it (it also sizes the service view); Ctrl+B in main arrives through onSidebar.
const collapsed = ref(false)
// Fully hidden sidebar and its dragged width (D52).
const sideHidden = ref(false)
const sideWidthPx = ref(232)
const shown = computed(() => visibleAccounts(accounts.value, disabled.value))
// Settings fills the main area; main detaches the service view while it is open (like a dialog). The sheet only exists inside it.
const settingsOpen = ref(false)
const sheetId = ref<string | undefined>()
const current = computed(() => shown.value.find((a) => a.id === selectedId.value))
// Split needs a second visible account (UX-015); a switched-off service never counts.
const others = computed(() => (current.value ? shown.value.filter((a) => a.id !== current.value!.id).length : 0))
const sheetAccount = computed(() => accounts.value.find((a) => a.id === sheetId.value))
const adding = ref(false)
const addError = ref('')
// Main owns the lock. The renderer asks for account data only while main says 'unlocked', and drops all of it on lock.
const lockInfo = ref<LockInfo>({ state: 'locked' })
const ready = ref(false)
// Forgot on the lock screen leads to the reset confirm screen.
const resetting = ref(false)
// Update status from main (D29); the sidebar pill and Settings > General show it. The pill opens General.
// Do Not Disturb and quiet hours (UX-049): the sidebar footer shows a bell-off chip while either is on.
const dnd = ref(false)
const quiet = ref(false)
const dndOn = computed(() => dnd.value || quiet.value)
// Notifications inbox (D64): the sidebar bell's unread count and the dialog's items.
const inbox = ref<InboxSnapshot>({ items: [], unread: 0 })
const inboxOpen = ref(false)
const update = ref<UpdateInfo>({ state: 'checking' })
// Lock countdown (D57): main pushes the time left under the active rule every few seconds; null = no chip.
const lockChip = ref<{ ms: number; rule: string } | null>(null)
// Split view (D62): the second account and the divider position pushed by main.
const split = ref<{ b: string; ratio: number } | undefined>()
// Per-account proxy (D63): a save error from main shown in the account sheet.
const proxyError = ref('')
// A main-frame page load failed (UX-010): the retry card covers the empty panel until a load starts.
const pageError = ref<{ id: string; description: string } | undefined>()
const shownPageError = computed(() => (pageError.value && current.value && pageError.value.id === current.value.id ? pageError.value : undefined))
// Page history per account (UX-013): main pushes it after every navigation and when a view is attached.
const navStates = ref<Record<string, { canBack: boolean; canForward: boolean }>>({})
const nav = computed(() => (current.value ? navStates.value[current.value.id] : undefined) ?? { canBack: false, canForward: false })
// Page loading (UX-046): main pushes one id at a time; the bar only shows for the selected account.
const loadingId = ref<string | undefined>()
const pageLoading = computed(() => !!current.value && loadingId.value === current.value.id)
const settingsTab = ref<string | undefined>()
// An external link that matches several accounts (D40): main asks, we answer once. Main detaches the view while it is open.
const choosing = ref<LinkChoice | undefined>()
// Ctrl+K quick switcher (D59): a modal over the app; main detaches the service view while any layer is open.
const switcherOpen = ref(false)
// F1 / ? shortcut cheat sheet (D60): the last, topmost layer.
const helpOpen = ref(false)

async function loadAccounts() {
  const s = await window.guisedesk.state()
  accounts.value = s.accounts
  selectedId.value = s.selectedId
  disabled.value = s.disabledServices
  collapsed.value = !!s.sidebarCollapsed
  sideHidden.value = !!s.sidebarHidden
  if (typeof s.sidebarWidth === 'number') sideWidthPx.value = s.sidebarWidth
  split.value = s.split
  counts.value = await window.guisedesk.unread()
  sleep.value = await window.guisedesk.sleep()
  update.value = await window.guisedesk.updateState()
  lockChip.value = (await window.guisedesk.lockCountdown?.()) ?? null
  const box = await window.guisedesk.inbox?.()
  if (box) inbox.value = box
  const b = await window.guisedesk.blockState?.()
  if (b) block.value = b
  const p = await window.guisedesk.prefs?.()
  if (p) {
    dnd.value = !!p.dnd
    quiet.value = !!p.quietWorkHours
  }
}

function wipe() {
  accounts.value = []
  selectedId.value = undefined
  counts.value = {}
  sleep.value = {}
  adding.value = false
  addError.value = ''
  choosing.value = undefined
  disabled.value = []
  settingsOpen.value = false
  sheetId.value = undefined
  switcherOpen.value = false
  helpOpen.value = false
  inbox.value = { items: [], unread: 0 }
  inboxOpen.value = false
  lockChip.value = null
  split.value = undefined
  pageError.value = undefined
  navStates.value = {}
  loadingId.value = undefined
  dnd.value = false
  quiet.value = false
}

// Any layer that must have the service view off the window (D59): Settings, Add account, the link chooser, the dialogs.
function overlayOpen(): boolean {
  return settingsOpen.value || adding.value || !!choosing.value || switcherOpen.value || helpOpen.value || inboxOpen.value
}
function syncDialog() {
  window.guisedesk.dialog(overlayOpen())
}

async function apply(info: LockInfo) {
  // The reset screen opened from Settings (unlocked) must not survive a lock; one opened from the lock screen stays until unlock.
  if (info.state !== 'locked' || lockInfo.value.state === 'unlocked') resetting.value = false
  lockInfo.value = info
  if (info.state === 'unlocked') await loadAccounts()
  else wipe()
  ready.value = true
}

// Esc closes the topmost layer (D53): a link choice, then Add account, then the account sheet, then Settings.
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || lockInfo.value.state !== 'unlocked') return
  if (helpOpen.value) closeHelp()
  else if (inboxOpen.value) closeInbox()
  else if (switcherOpen.value) closeSwitcher()
  else if (choosing.value) chosen(null)
  else if (adding.value) closeAdd()
  else if (sheetId.value) sheetId.value = undefined
  else if (settingsOpen.value) closeSettings()
  else return
  e.preventDefault()
}
// ? (Shift+/) in the app window opens the cheat sheet, unless a field has focus (D60). F1 arrives from main.
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}
function onHelpKey(e: KeyboardEvent) {
  if (e.key !== '?' || lockInfo.value.state !== 'unlocked' || typing()) return
  e.preventDefault()
  openHelp()
}
onMounted(() => {
  window.addEventListener('keydown', onEsc)
  window.addEventListener('keydown', onHelpKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('keydown', onHelpKey)
})

onMounted(async () => {
  window.guisedesk.onLock((info) => void apply(info))
  window.guisedesk.onSleep((s) => (sleep.value = s))
  window.guisedesk.onUpdate((u) => (update.value = u))
  window.guisedesk.onLockCountdown?.((c) => (lockChip.value = c))
  window.guisedesk.onZoom((s) => take(s))
  window.guisedesk.onBlock?.((s) => (block.value = s))
  window.guisedesk.onOpenSettingsTab?.((t) => {
    if (lockInfo.value.state !== 'unlocked') return
    settingsTab.value = undefined
    openSettings()
    void nextTick(() => (settingsTab.value = t))
  })
  window.guisedesk.onSidebar((c) => (collapsed.value = c))
  window.guisedesk.onSidebarLayout?.((l) => {
    collapsed.value = l.collapsed
    sideHidden.value = l.hidden
    sideWidthPx.value = l.width
  })
  window.guisedesk.onSplit?.((s) => (split.value = s))
  window.guisedesk.onNavState?.((s) => (navStates.value = { ...navStates.value, [s.id]: { canBack: s.canBack, canForward: s.canForward } }))
  window.guisedesk.onLoading?.((p) => {
    if (p.loading) loadingId.value = p.id
    else if (loadingId.value === p.id) loadingId.value = undefined
  })
  window.guisedesk.onPageError?.((p) => {
    if (p.cleared) {
      if (pageError.value?.id === p.id) pageError.value = undefined
      return
    }
    pageError.value = { id: p.id, description: p.description ?? 'The page could not be loaded.' }
  })
  window.guisedesk.onUnread((c) => (counts.value = { ...c }))
  window.guisedesk.onDnd?.((on) => (dnd.value = on))
  window.guisedesk.onQuiet?.((on) => (quiet.value = on))
  window.guisedesk.onInbox?.((s) => (inbox.value = s))
  window.guisedesk.onSelected((id) => {
    selectedId.value = id
    closeSettings()
  })
  // The proxy chip's "Change..." asks for this account's sheet (D63).
  window.guisedesk.onOpenSheet?.((id) => {
    if (lockInfo.value.state !== 'unlocked' || !accounts.value.some((a) => a.id === id)) return
    openSheet(id)
  })
  window.guisedesk.onLinkChoose((r) => {
    if (lockInfo.value.state !== 'unlocked') return
    choosing.value = r
    syncDialog()
  })
  // Ctrl+K (D59) from main, whether focus was in the window or a service view.
  window.guisedesk.onSwitcher?.(() => openSwitcher())
  // F1 (D60) from main: the cheat sheet, over whatever else is open.
  window.guisedesk.onShortcuts?.(() => openHelp())
  window.guisedesk.onOpenSettings(() => lockInfo.value.state === 'unlocked' && openSettings())
  await apply(await window.guisedesk.lockState())
  // Dev-only: the screenshot hook opens the dialog via ?dialog=add (or settings, with ?sheet=<account id>).
  if (lockInfo.value.state === 'unlocked' && new URLSearchParams(location.search).get('dialog') === 'add') openAdd()
  if (lockInfo.value.state === 'unlocked' && new URLSearchParams(location.search).get('dialog') === 'settings') {
    openSettings()
    const id = new URLSearchParams(location.search).get('sheet')
    if (id) sheetId.value = id
  }
  if (lockInfo.value.state === 'locked' && new URLSearchParams(location.search).get('dialog') === 'reset') resetting.value = true
})

function select(id: string) {
  closeSettings()
  selectedId.value = id
  window.guisedesk.select(id)
}

function take(s: Snapshot) {
  accounts.value = s.accounts
  selectedId.value = s.selectedId
  disabled.value = s.disabledServices
}

async function mute(id: string, muted: boolean) {
  take(await window.guisedesk.mute(id, muted))
}

// Per-account proxy (D63): the sheet checks the address locally; main re-checks and saves.
async function setProxy(id: string, value: string) {
  proxyError.value = ''
  const r = await window.guisedesk.setProxy(id, value)
  if ('error' in r) proxyError.value = r.error
  else take(r)
}

function openProxyMenu(id: string) {
  window.guisedesk.proxyMenu(id)
}

async function setBlur(id: string, on: boolean) {
  take(await window.guisedesk.setBlur(id, on))
}

async function setBlurPart(id: string, part: string, on: boolean) {
  take(await window.guisedesk.setBlurPart(id, part, on))
}

async function setExtension(id: string, extId: string, on: boolean) {
  take(await window.guisedesk.setExtension(id, extId, on))
}

async function setKeepDeleted(id: string, on: boolean) {
  take(await window.guisedesk.setKeepDeleted(id, on))
}

// Ad and pop-up blocking chips (D45), pushed by main.
const block = ref<BlockSnapshot>({ ads: false, accounts: {} })
function extensionMenu(id: string) {
  window.guisedesk.extensionMenu(id)
}
function shieldMenu(id: string) {
  window.guisedesk.shieldMenu(id)
}
async function openBlockedPopup(id: string) {
  await window.guisedesk.openBlockedPopup(id)
}

async function resetZoom(id: string) {
  take(await window.guisedesk.resetZoom(id))
}

async function reorder(ids: string[]) {
  take(await window.guisedesk.reorder(ids))
}

function sleepNow(id: string) {
  window.guisedesk.sleepNow(id)
}
function reload(id: string) {
  window.guisedesk.reload(id)
}
function home(id: string) {
  window.guisedesk.home(id)
}
function openSite(id: string) {
  window.guisedesk.openSite(id)
}
function back(id: string) {
  window.guisedesk.back(id)
}
function forward(id: string) {
  window.guisedesk.forward(id)
}

function lockNow() {
  window.guisedesk.lock()
}

function openLockMenu() {
  window.guisedesk.lockMenu?.()
}

function hideSidebar(h: boolean) {
  sideHidden.value = h
  window.guisedesk.setSidebarHidden(h)
}
function resizeSidebar(w: number) {
  sideWidthPx.value = w
  window.guisedesk.setSidebarWidth(w)
}
function toggleSidebar() {
  window.guisedesk.setSidebar(!collapsed.value)
}

// Split view (D62): the native menu picks the second account; the divider resizes both pages.
function openSplitMenu() {
  if (current.value) window.guisedesk.splitMenu(current.value.id)
}

function closeSplit() {
  window.guisedesk.closeSplit()
}

function moveSplit(ratio: number) {
  if (!split.value) return
  split.value = { ...split.value, ratio }
  window.guisedesk.setSplitRatio(ratio)
}

function endSplitDrag(ratio: number) {
  if (!split.value) return
  split.value = { ...split.value, ratio }
  window.guisedesk.saveSplitRatio(ratio)
}

// Quick switcher (D59): main asks, the app lists its visible accounts and opens the picked one.
function openSwitcher() {
  if (lockInfo.value.state !== 'unlocked') return
  switcherOpen.value = true
  syncDialog()
}

function closeSwitcher() {
  if (!switcherOpen.value) return
  switcherOpen.value = false
  syncDialog()
}

function pickSwitcher(id: string) {
  switcherOpen.value = false
  select(id)
  syncDialog()
}

// Shortcut cheat sheet (D60): F1, ? or the Settings > General row. It sits above every other layer.
function openHelp() {
  if (lockInfo.value.state !== 'unlocked') return
  switcherOpen.value = false
  helpOpen.value = true
  syncDialog()
}

function closeHelp() {
  if (!helpOpen.value) return
  helpOpen.value = false
  syncDialog()
}

// Notifications inbox (D64): the sidebar bell opens it; an item marks itself read and selects that account.
function openInbox() {
  if (lockInfo.value.state !== 'unlocked') return
  inboxOpen.value = true
  syncDialog()
}

function closeInbox() {
  if (!inboxOpen.value) return
  inboxOpen.value = false
  syncDialog()
}

async function pickInbox(accountId: string, itemId: string) {
  const box = await window.guisedesk.inboxRead(itemId)
  if (box) inbox.value = box
  closeInbox()
  if (accounts.value.some((a) => a.id === accountId)) select(accountId)
}

async function markInboxUnread(id: string) {
  const box = await window.guisedesk.inboxUnread(id)
  if (box) inbox.value = box
}

async function readAllInbox() {
  const box = await window.guisedesk.inboxReadAll()
  if (box) inbox.value = box
}

async function clearInbox() {
  const box = await window.guisedesk.inboxClear()
  if (box) inbox.value = box
}

// An item whose service was switched off (UX-042): lead to Settings > Services instead of a click that does nothing.
function openServicesFromInbox() {
  closeInbox()
  settingsTab.value = undefined
  openSettings()
  void nextTick(() => (settingsTab.value = 'Services'))
}

function openSettings() {
  if (settingsOpen.value) return
  settingsOpen.value = true
  syncDialog()
}

// A sidebar cue (switched-off services, UX-045) opens Settings straight on a tab; the gear opens the default.
function openSettingsAt(tab?: string) {
  if (!tab) return openSettings()
  settingsTab.value = undefined
  openSettings()
  void nextTick(() => (settingsTab.value = tab))
}

function openUpdates() {
  settingsTab.value = undefined
  openSettings()
  void nextTick(() => (settingsTab.value = 'General'))
}

// The sidebar DND chip (UX-049): straight to the tab that turns it off.
function openNotificationsSettings() {
  openSettingsAt('Notifications')
}

async function checkUpdate() {
  update.value = { state: 'checking' }
  update.value = await window.guisedesk.updateCheck()
}

function applyUpdate() {
  void window.guisedesk.updateApply()
}

function closeSettings() {
  sheetId.value = undefined
  settingsTab.value = undefined
  proxyError.value = ''
  if (!settingsOpen.value) return
  settingsOpen.value = false
  syncDialog()
}

function openSheet(id: string) {
  proxyError.value = ''
  openSettings()
  sheetId.value = id
}

async function toggleService(serviceId: string, enabled: boolean) {
  take(await window.guisedesk.setServiceEnabled(serviceId, enabled))
}

async function setPolicy(id: string, policy: string) {
  take(await window.guisedesk.setPolicy(id, policy))
}

async function editAccount(id: string, label: string, colour: string) {
  take(await window.guisedesk.edit({ id, label, colour }))
}

async function logout(id: string) {
  take(await window.guisedesk.logout(id))
}

async function removeAccount(id: string) {
  sheetId.value = undefined
  take(await window.guisedesk.remove(id))
}

function chosen(choice: string | null) {
  if (!choosing.value) return
  window.guisedesk.chooseLink(choosing.value.id, choice)
  choosing.value = undefined
  syncDialog()
}

function openAdd() {
  adding.value = true
  syncDialog()
}

function closeAdd() {
  adding.value = false
  syncDialog()
}

async function add(input: Parameters<Window['guisedesk']['add']>[0]) {
  const r = await window.guisedesk.add(input)
  if ('error' in r) {
    addError.value = r.error
    return
  }
  take(r)
  closeAdd()
}
</script>

<template>
  <template v-if="!ready"></template>
  <SetupScreen v-else-if="lockInfo.state === 'setup'" />
  <ResetScreen v-else-if="resetting" @cancel="resetting = false" />
  <LockScreen v-else-if="lockInfo.state === 'locked'" :kind="lockInfo.kind ?? 'pin'" :pin-length="lockInfo.pinLength" :wait-until="lockInfo.waitUntil" @forgot="resetting = true" />
  <div v-else class="shell">
    <div v-if="sideHidden" class="sidestrip">
      <button class="showside" title="Show sidebar (Ctrl+B)" aria-label="Show sidebar" @click="hideSidebar(false)"><svg class="i" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
      <button class="bell" :title="inbox.unread ? inbox.unread + ' unread notifications' : 'Notifications'" aria-label="Notifications" @click="openInbox"><svg class="i" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg><span v-if="inbox.unread > 0" class="badge">{{ formatCount(inbox.unread) }}</span></button>
    </div>
    <Sidebar v-if="!sideHidden" :width="sideWidthPx" @hide="hideSidebar(true)" @resize="resizeSidebar" :accounts="shown" :selected-id="selectedId" :counts="counts" :asleep="asleepIds" :collapsed="collapsed" :update="update.state === 'available'" :inbox-unread="inbox.unread" :disabled="disabled" :dnd="dndOn" @inbox="openInbox" @notifications="openNotificationsSettings" @update="openUpdates" @toggle="toggleSidebar" @select="select" @add="openAdd" @mute="mute" @sleep="sleepNow" @reorder="reorder" @settings="openSettingsAt" @account="openSheet" />
    <main class="main">
      <TopBar v-if="!settingsOpen && current" :account="current" :asleep="!!sleep[current.id]" :lock="lockChip" :proxy="current.proxy" :split="!!split" :others="others" :nav="nav" :loading="pageLoading" @lock-menu="openLockMenu" @proxy-menu="openProxyMenu(current!.id)" @reload="reload(current!.id)" @home="home(current!.id)" @back="back(current!.id)" @forward="forward(current!.id)" @mute="(m) => mute(current!.id, m)" @lock="lockNow" @sleep="sleepNow(current!.id)" @settings="openSheet(current.id)" @reset-zoom="resetZoom(current!.id)" :ads-on="block.ads" :blocked="block.accounts[current.id]?.blocked ?? 0" :popup="block.accounts[current.id]?.popup" @open-popup="openBlockedPopup(current!.id)" @shield="shieldMenu(current!.id)" @extensions="extensionMenu(current!.id)" @split-menu="openSplitMenu" @close-split="closeSplit" />
      <Settings v-if="settingsOpen" :accounts="accounts" :disabled="disabled" :update="update" :tab="settingsTab" @check="checkUpdate" @apply="applyUpdate" @back="closeSettings" @toggle="toggleService" @open="(id) => (sheetId = id)" @unmute="(id) => mute(id, false)" @reset="resetting = true" @shortcuts="openHelp" />
      <AsleepPanel v-else-if="sleeping" :account="sleeping" :minutes="sleep[sleeping.id].minutes" @wake="select(sleeping.id)" />
      <div v-else-if="!accounts.length" class="panel empty">
        <div>
          <BrandMark :size="64" />
          <h3>No accounts yet</h3>
          <p class="hint">Each account gets its own sealed session.</p>
          <button class="btn pri" @click="openAdd">Add your first account</button>
        </div>
      </div>
      <div v-else-if="!shown.length" class="panel empty">
        <div>
          <BrandMark :size="64" />
          <h3>Every service is switched off</h3>
          <p class="hint">Switch a service back on in Settings to see its accounts.</p>
          <button class="btn" @click="openSettings">Open Settings</button>
        </div>
      </div>
      <div v-else class="panel">
        <SplitDivider v-if="split" :ratio="split.ratio" @move="moveSplit" @end="endSplitDrag" />
        <div v-if="shownPageError" class="page-error">
          <h3>The page did not load</h3>
          <p class="hint">{{ shownPageError.description }}</p>
          <div class="btns">
            <button class="btn" @click="openSite(shownPageError.id)">Open site in browser</button>
            <button class="btn pri" @click="reload(shownPageError.id)">Try again</button>
          </div>
        </div>
      </div>
    </main>
    <AccountSheet
      v-if="settingsOpen && sheetAccount"
      :account="sheetAccount"
      :accounts="accounts"
      :proxy-error="proxyError"
      @policy="(v) => setPolicy(sheetAccount!.id, v)"
      @mute="(m) => mute(sheetAccount!.id, m)"
      @blur="(on) => setBlur(sheetAccount!.id, on)"
      @blur-part="(part, on) => setBlurPart(sheetAccount!.id, part, on)"
      @keep-deleted="(on) => setKeepDeleted(sheetAccount!.id, on)"
      @proxy="(v) => setProxy(sheetAccount!.id, v)"
      @edit="(label, colour) => editAccount(sheetAccount!.id, label, colour)"
      @logout="logout(sheetAccount!.id)"
      @remove="removeAccount(sheetAccount!.id)"
      @done="sheetId = undefined"
    />
    <LinkChooser v-if="choosing" :url="choosing.url" :candidates="choosing.candidates" @choose="chosen" />
    <AddAccount v-if="adding" :accounts="accounts" :server-error="addError" @add="add" @cancel="closeAdd" />
    <QuickSwitcher v-if="switcherOpen" :accounts="shown" @choose="pickSwitcher" @close="closeSwitcher" />
    <Inbox v-if="inboxOpen" :items="inbox.items" :accounts="accounts" :disabled="disabled" @select="pickInbox" @unread="markInboxUnread" @read-all="readAllInbox" @clear="clearInbox" @open-services="openServicesFromInbox" @close="closeInbox" />
    <ShortcutHelp v-if="helpOpen" @close="closeHelp" />
  </div>
</template>

<style scoped>
.empty, .page-error { display: grid; place-items: center; text-align: center; }
.empty { height: 100%; }
.empty h3, .page-error h3 { margin: 16px 0 6px; font-size: 18px; font-weight: 800; }
.empty .hint, .page-error .hint { margin: 0 0 18px; }
.page-error { position: absolute; inset: 0; }
.page-error .btns { margin-top: 0; justify-content: center; }
</style>
