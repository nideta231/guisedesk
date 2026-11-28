<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { presetFor } from '../../main/presets'
import { filterAccounts, moveSelection, type QuickRow } from '../../main/quick'
import { initials } from './initials'
import { useDialogFocus } from './useDialogFocus'

const props = defineProps<{ accounts: AccountRow[] }>()
const emit = defineEmits<{ choose: [id: string]; close: [] }>()

interface Row extends QuickRow {
  serviceId: string
  colour: string
}
const rows = computed<Row[]>(() =>
  props.accounts.map((a) => ({
    id: a.id,
    label: a.label,
    service: presetFor(a.serviceId)?.name ?? a.custom?.name ?? 'Custom site',
    serviceId: a.serviceId,
    colour: a.colour
  }))
)

const query = ref('')
const list = computed(() => filterAccounts(rows.value, query.value))
const active = ref(0)
// A new query re-ranks the list; the first hit is highlighted.
watch(list, () => (active.value = 0))

const results = ref<HTMLElement>()
const glass = ref<HTMLElement>()
useDialogFocus(glass)

// Keep the highlighted row on screen (UX-025): the list is taller than its 300px box.
watch(active, async () => {
  await nextTick()
  const row = results.value?.querySelectorAll<HTMLElement>('.row')[active.value]
  if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
})

function choose(id: string) {
  emit('choose', id)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = moveSelection(active.value, 1, list.value.length)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = moveSelection(active.value, -1, list.value.length)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const row = list.value[active.value]
    if (row) choose(row.id)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="veil" @click.self="emit('close')">
    <div ref="glass" class="glass switcher" role="dialog" aria-modal="true" aria-label="Quick switcher">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="emit('close')"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>Quick switcher</h3>
      <input v-model="query" class="inp search" placeholder="Search accounts..." aria-label="Search accounts" @keydown="onKey" />
      <div ref="results" class="results">
        <div
          v-for="(r, i) in list"
          :key="r.id"
          class="row"
          :class="{ on: i === active }"
          @click="choose(r.id)"
          @mousemove="active = i"
        >
          <div class="av" :style="{ background: r.colour }">{{ initials(r.label) }}</div>
          <div class="nm">{{ r.label }}</div>
          <div class="svcn">{{ r.service }}</div>
        </div>
        <div v-if="!list.length" class="hint none">No accounts match "{{ query }}".</div>
      </div>
      <div class="keys hint">Type to search. Up and down to move, Enter to open, Esc to close.</div>
    </div>
  </div>
</template>

<style scoped>
.switcher { width: 440px; }
.results { max-height: 300px; overflow-y: auto; margin-bottom: 10px; }
.row { color: var(--text); }
.nm { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.svcn { color: var(--muted); font-size: 12.5px; }
.none { padding: 10px 8px; }
</style>
