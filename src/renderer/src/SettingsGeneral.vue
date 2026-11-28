<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { version } from '../../../package.json'
import BackupDialog from './BackupDialog.vue'

const props = defineProps<{ update: UpdateInfo }>()
const emit = defineEmits<{ check: []; apply: []; shortcuts: [] }>()
const status = computed(() => {
  const u = props.update
  if (u.state === 'available') return `${u.latest} available`
  if (u.state === 'error') return `Could not check: ${u.message ?? 'unknown error'}`
  if (u.state === 'disabled') return 'Not available in this install'
  if (u.state === 'checking') return 'Checking...'
  return 'Up to date'
})
// Custom build (D55): local commits on top of a release tag; the updater would drop them, so it is off.
const custom = computed(() => props.update.custom)
const customText = computed(() => {
  const c = custom.value
  if (!c) return ''
  return `Custom build (${c.count} change${c.count === 1 ? '' : 's'} on top of ${c.tag})`
})

const on = ref(false)
onMounted(async () => {
  on.value = (await window.guisedesk.prefs()).startOnLogin
})

const dl = ref<{ dir: string; ask: boolean }>({ dir: '', ask: false })
onMounted(async () => {
  dl.value = await window.guisedesk.downloads()
})

const block = ref({ ads: false, popups: true })
onMounted(async () => {
  const b = await window.guisedesk.blocking?.()
  if (b) block.value = b
})

async function toggleBlock(key: 'ads' | 'popups') {
  const next = !block.value[key]
  if (await window.guisedesk.setBlocking({ [key]: next })) block.value = { ...block.value, [key]: next }
}

async function toggleAsk() {
  const next = !dl.value.ask
  if (await window.guisedesk.setDownloadsAsk(next)) dl.value = { ...dl.value, ask: next }
}

async function pick() {
  const dir = await window.guisedesk.pickDownloadsDir()
  if (dir) dl.value = { ...dl.value, dir }
}

async function toggle() {
  const next = !on.value
  if (await window.guisedesk.setStartOnLogin(next)) on.value = next
}

// About and data (UX-007): the folder main writes to, and its event log for troubleshooting.
function openData() {
  void window.guisedesk.openDataFolder()
}
function showLog() {
  void window.guisedesk.showEventLog()
}

// Quit (UX-031): closing the window only hides it to the tray, so a real Quit lives here too.
function quitApp() {
  void window.guisedesk.quit()
}

const backupMode = ref<'export' | 'restore' | undefined>()
</script>

<template>
  <div class="cards">
    <div class="card">
      <h4>Startup</h4>
      <div class="sr">
        <span class="t"><b>Start on login</b><span>Opens hidden in the tray, and locked.</span></span>
        <button class="tg" :class="{ on }" role="switch" :aria-checked="on" aria-label="Start on login" @click="toggle"></button>
      </div>
    </div>
    <div class="card">
      <h4>Downloads</h4>
      <div class="sr">
        <span class="t"><b>Folder</b><span class="path" :title="dl.dir">{{ dl.dir }}</span></span>
        <button class="btn" @click="pick">Change...</button>
      </div>
      <div class="sr">
        <span class="t"><b>Ask where to save each time</b><span>Otherwise files go straight to the folder.</span></span>
        <button class="tg" :class="{ on: dl.ask }" role="switch" :aria-checked="dl.ask" aria-label="Ask where to save each time" @click="toggleAsk"></button>
      </div>
    </div>
    <div class="card">
      <h4>Blocking</h4>
      <div class="sr">
        <span class="t"><b>Block ads and trackers</b><span>EasyList and uBlock Origin ad and tracker lists, in every account. Open pages reload.</span></span>
        <button class="tg" :class="{ on: block.ads }" role="switch" :aria-checked="block.ads" aria-label="Block ads and trackers" @click="toggleBlock('ads')"></button>
      </div>
      <div class="sr">
        <span class="t"><b>Block pop-ups</b><span>Windows a page opens without a click, and ad pages, are dropped. Middle-click and sign-in windows still open.</span></span>
        <button class="tg" :class="{ on: block.popups }" role="switch" :aria-checked="block.popups" aria-label="Block pop-ups" @click="toggleBlock('popups')"></button>
      </div>
    </div>
    <div class="card">
      <h4>Keyboard</h4>
      <div class="sr">
        <span class="t"><b>Keyboard shortcuts</b><span>See every shortcut the app has.</span></span>
        <button class="lnk" @click="emit('shortcuts')">Show shortcuts</button>
      </div>
    </div>
    <div class="card">
      <h4>About and data</h4>
      <div class="sr">
        <span class="t"><b>Data folder</b><span>Sessions, settings and logs live here.</span></span>
        <button class="btn" @click="openData">Open data folder</button>
      </div>
      <div class="sr">
        <span class="t"><b>Event log</b><span>Recent app events, for troubleshooting.</span></span>
        <button class="btn" @click="showLog">Show event log</button>
      </div>
    </div>
    <div class="card">
      <h4>Backup</h4>
      <div class="sr">
        <span class="t"><b>Export backup</b><span>One encrypted file with accounts, settings, lock and extensions. You can include saved logins.</span></span>
        <button class="btn" @click="backupMode = 'export'">Export backup...</button>
      </div>
      <div class="sr">
        <span class="t"><b>Restore backup</b><span>Open a backup on the next start. It replaces all current data.</span></span>
        <button class="btn" @click="backupMode = 'restore'">Restore backup...</button>
      </div>
    </div>
    <div class="card">
      <h4>Updates</h4>
      <div class="sr">
        <span class="t"><b>GuiseDesk v{{ version }}</b><span v-if="custom" class="custom">{{ customText }}</span><span>{{ status }}</span></span>
        <button class="btn" :disabled="update.state === 'checking'" @click="emit('check')">Check for updates</button>
        <span v-if="custom" class="hint">Updates are off for a custom build</span>
        <button v-else-if="update.state === 'available'" class="btn pri" @click="emit('apply')">Update and restart</button>
      </div>
    </div>
    <div class="card">
      <h4>Quit</h4>
      <div class="sr">
        <span class="t"><b>Quit GuiseDesk</b><span>Closing the window only hides it to the tray.</span></span>
        <button class="btn dng" @click="quitApp">Quit GuiseDesk</button>
      </div>
    </div>
    <BackupDialog v-if="backupMode" :mode="backupMode" @close="backupMode = undefined" />
  </div>
</template>

<style scoped>
.path { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lnk { flex: none; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #ffffff18; background: transparent; color: var(--text); font-size: 12.5px; font-weight: 700; }
.lnk:hover { background: var(--raise); }
</style>
