<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{ accounts: AccountRow[] }>()
const list = ref<ExtensionRow[]>([])
const link = ref('')
const busy = ref(false)
const error = ref('')
const rows = ref<AccountRow[]>([])
const updating = ref(false)
const updateMsg = ref('')
const confirming = ref<string | undefined>(undefined)

onMounted(async () => {
  list.value = await window.guisedesk.extensions()
  rows.value = props.accounts
})

async function checkUpdates() {
  if (updating.value) return
  updating.value = true
  updateMsg.value = ''
  try {
    const r = await window.guisedesk.checkExtensionUpdates()
    list.value = await window.guisedesk.extensions()
    const names = new Map(list.value.map((x) => [x.id, x.name]))
    updateMsg.value = r.updated.length
      ? `${r.updated.length} updated: ${r.updated.map((u) => `${names.get(u.id) ?? 'Extension'} ${u.version}`).join(', ')}`
      : r.checked
        ? 'Everything is up to date.'
        : 'No extensions to check yet.'
  } catch {
    updateMsg.value = 'Could not check for updates. Try again later.'
  } finally {
    updating.value = false
  }
}

async function add() {
  if (!link.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  const r = await window.guisedesk.installExtension(link.value.trim())
  busy.value = false
  if ('error' in r) error.value = r.error
  else {
    list.value = r.list
    link.value = ''
  }
}

async function remove(id: string) {
  list.value = await window.guisedesk.removeExtension(id)
  rows.value = rows.value.map((a) => ({ ...a, extensions: a.extensions?.filter((x) => x !== id) }))
  if (confirming.value === id) confirming.value = undefined
}

async function toggle(a: AccountRow, id: string) {
  const s = await window.guisedesk.setExtension(a.id, id, !a.extensions?.includes(id))
  rows.value = s.accounts
}
</script>

<template>
  <div class="cards">
    <div class="card">
      <h4>Updates</h4>
      <div class="sr">
        <span class="t"><b>Check for updates</b><span>New versions are checked with the Chrome Web Store once a week and loaded for accounts that have the extension on.</span></span>
        <button class="btn" :disabled="updating" @click="checkUpdates">{{ updating ? 'Checking...' : 'Check for updates' }}</button>
      </div>
      <div v-if="updateMsg" class="hint">{{ updateMsg }}</div>
    </div>
    <div class="card">
      <h4>Add from the Chrome Web Store</h4>
      <div class="sr">
        <span class="t"><b>Store link</b><span>Open the extension in the Chrome Web Store and copy the address. It stays off until you turn it on for an account.</span></span>
      </div>
      <div class="sr">
        <input v-model="link" class="in" placeholder="https://chromewebstore.google.com/detail/..." aria-label="Chrome Web Store link" @keydown.enter="add" />
        <button class="btn pri" :disabled="busy || !link.trim()" @click="add">{{ busy ? 'Adding...' : 'Add' }}</button>
      </div>
      <div v-if="error" class="hint warn">{{ error }}</div>
    </div>
    <div v-for="x in list" :key="x.id" class="card ext" :data-ext="x.id">
      <h4>{{ x.name }} <span class="ver">{{ x.version }}</span><span v-if="x.updated" class="updated">Updated {{ x.updated }}</span></h4>
      <div v-for="a in rows" :key="a.id" class="sr">
        <span class="t"><b>{{ a.label }}</b><span>{{ a.serviceId }}</span></span>
        <button class="tg" :class="{ on: a.extensions?.includes(x.id) }" role="switch" :aria-checked="!!a.extensions?.includes(x.id)" :aria-label="`${x.name} for ${a.label}`" @click="toggle(a, x.id)"></button>
      </div>
      <div v-if="confirming === x.id" class="confirm">
        <div class="err">Remove {{ x.name }}? It will be turned off for every account.</div>
        <div class="btns"><button class="btn" @click="confirming = undefined">Cancel</button><button class="btn dng" @click="remove(x.id)">Remove</button></div>
      </div>
      <div v-else class="sr"><span class="t"><span>Extensions can read and change the pages they run on. Only turn on ones you trust.</span></span><button class="btn" @click="confirming = x.id">Remove</button></div>
    </div>
    <div v-if="!list.length" class="card"><div class="sr"><span class="t"><span>No extensions yet.</span></span></div></div>
  </div>
</template>

<style scoped>
.in { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid #ffffff1f; background: #0000002e; color: inherit; font: inherit; }
.ver { opacity: 0.6; font-weight: 400; margin-left: 6px; }
.updated { display: block; margin-top: 2px; font-size: 12px; font-weight: 400; opacity: 0.7; }
</style>
