<script setup lang="ts">
import { computed, ref } from 'vue'
import { backupDate, passwordProblem } from '../../main/backuprules'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{ mode: 'export' | 'restore' }>()
const emit = defineEmits<{ close: [] }>()
const glass = ref<HTMLElement>()
useDialogFocus(glass)

const password = ref('')
const repeat = ref('')
const includeLogins = ref(false)
const file = ref('')
const manifest = ref<BackupManifest | null>(null)
const error = ref('')
const saved = ref('')
const busy = ref(false)

const title = computed(() => (props.mode === 'export' ? 'Export backup' : 'Restore backup'))
const created = computed(() => backupDate(manifest.value?.created))
const fileName = (p: string) => p.split(/[\\/]/).pop() || p

function close() {
  emit('close')
}

async function doExport() {
  if (busy.value) return
  const problem = passwordProblem(password.value, repeat.value)
  if (problem) {
    error.value = problem
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await window.guisedesk.exportBackup({ password: password.value, includeLogins: includeLogins.value })
    if ('error' in r) {
      error.value = r.error
      return
    }
    if ('canceled' in r) return
    saved.value = r.file
    password.value = ''
    repeat.value = ''
  } catch {
    error.value = 'Could not create the backup. Try again.'
  } finally {
    busy.value = false
  }
}

async function pick() {
  if (busy.value) return
  error.value = ''
  manifest.value = null
  try {
    const r = await window.guisedesk.pickBackup()
    if ('file' in r) file.value = r.file
  } catch {
    error.value = 'Could not open the file chooser.'
  }
}

async function inspect() {
  if (busy.value) return
  if (!file.value) {
    error.value = 'Choose a backup file first.'
    return
  }
  if (!password.value) {
    error.value = 'Type the backup password.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await window.guisedesk.inspectBackup({ file: file.value, password: password.value })
    if ('error' in r) {
      manifest.value = null
      error.value = r.error
      return
    }
    manifest.value = r.manifest
  } catch {
    error.value = 'Could not open the backup. Check the file and the password.'
  } finally {
    busy.value = false
  }
}

async function restore() {
  if (busy.value || !manifest.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await window.guisedesk.restoreBackup({ file: file.value, password: password.value })
    if ('error' in r) {
      error.value = r.error
      return
    }
    saved.value = 'Restoring. GuiseDesk will close now.'
  } catch {
    error.value = 'Could not prepare the restore. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="veil" @click.self="close">
    <div ref="glass" class="glass backup" :class="mode" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc.stop="close">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="close"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>{{ title }}</h3>

      <template v-if="mode === 'export'">
        <p class="sub">One file with your accounts, settings, lock and the extension ids. It is encrypted with the password you type here.</p>
        <label class="chk"><input v-model="includeLogins" type="checkbox" /> Include logins</label>
        <p class="hint logins">Cookies and local data for every account. Without this you sign in again after restoring.</p>
        <input v-model="password" class="inp" type="password" placeholder="Password (at least 8 characters)" aria-label="Backup password" @keydown.enter="doExport" />
        <input v-model="repeat" class="inp" type="password" placeholder="Type the password again" aria-label="Repeat backup password" @keydown.enter="doExport" />
        <div v-if="error" class="err">{{ error }}</div>
        <div v-if="saved" class="hint done">Backup saved to {{ saved }}</div>
        <div class="btns">
          <button class="btn" @click="close">{{ saved ? 'Close' : 'Cancel' }}</button>
          <button v-if="!saved" class="btn pri" :disabled="busy" @click="doExport">{{ busy ? 'Exporting...' : 'Export' }}</button>
        </div>
      </template>

      <template v-else>
        <p class="sub">Open a backup file to see what it holds. Nothing is replaced until you confirm.</p>
        <div class="sr file">
          <span class="t"><b>{{ file ? fileName(file) : 'No file chosen' }}</b><span>{{ file || 'Choose the .gdbackup file you exported.' }}</span></span>
          <button class="btn" @click="pick">{{ file ? 'Change...' : 'Choose file...' }}</button>
        </div>
        <input v-model="password" class="inp" type="password" placeholder="Backup password" aria-label="Backup password" @keydown.enter="inspect" />
        <div v-if="error" class="err">{{ error }}</div>
        <div v-if="manifest" class="manifest">
          <div class="lbl">This backup contains</div>
          <div class="mrow"><span>Created</span><b>{{ created }}</b></div>
          <div class="mrow"><span>Accounts</span><b>{{ manifest.accounts }}</b></div>
          <div class="mrow"><span>Extensions</span><b>{{ manifest.extensions.length ? manifest.extensions.length : 'None' }}</b></div>
          <div class="mrow"><span>Saved logins</span><b>{{ manifest.includeLogins ? 'Yes' : 'No' }}</b></div>
          <div class="warn">This replaces all current accounts, settings and saved logins. GuiseDesk will close and restore on the next start.</div>
        </div>
        <div v-if="saved" class="hint done">{{ saved }}</div>
        <div class="btns">
          <button class="btn" @click="close">{{ saved ? 'Close' : 'Cancel' }}</button>
          <button v-if="!manifest" class="btn pri" :disabled="busy" @click="inspect">{{ busy ? 'Checking...' : 'Open backup' }}</button>
          <button v-else class="btn dng" :disabled="busy || !!saved" @click="restore">{{ busy ? 'Preparing...' : 'Restore and restart' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.backup { width: 470px; }
.chk { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin: 4px 0 2px; }
.logins { margin: 0 0 12px; }
.done { margin-top: 6px; overflow-wrap: anywhere; }
.file { padding: 0 0 10px; }
.file .t span { overflow-wrap: anywhere; }
.manifest { margin-top: 6px; border-top: 1px solid var(--line); padding-top: 10px; }
.mrow { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 12.5px; color: var(--muted); }
.mrow b { color: var(--text); }
.warn { margin-top: 10px; font-size: 12px; font-weight: 600; color: var(--accent); }
</style>
