<script setup lang="ts">
import { computed, ref } from 'vue'
import { SHORTCUTS, type ShortcutInfo } from '../../main/shortcuts'
import { useDialogFocus } from './useDialogFocus'

const emit = defineEmits<{ close: [] }>()
const glass = ref<HTMLElement>()
useDialogFocus(glass)

const groups = computed(() => {
  const out: { title: string; rows: ShortcutInfo[] }[] = []
  for (const s of SHORTCUTS) {
    let g = out.find((x) => x.title === s.group)
    if (!g) out.push((g = { title: s.group, rows: [] }))
    g.rows.push(s)
  }
  return out
})
</script>

<template>
  <div class="veil" @click.self="emit('close')">
    <div ref="glass" class="glass help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" @keydown.esc.stop="emit('close')">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="emit('close')"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>Keyboard shortcuts</h3>
      <div v-for="g in groups" :key="g.title" class="grp">
        <div class="gt">{{ g.title }}</div>
        <div v-for="s in g.rows" :key="s.keys" class="hrow">
          <span class="hd">{{ s.title }}</span>
          <kbd>{{ s.keys }}</kbd>
        </div>
      </div>
      <div class="btns"><button class="btn pri" @click="emit('close')">Close</button></div>
    </div>
  </div>
</template>

<style scoped>
.help { width: 500px; }
.grp { margin-top: 14px; }
.gt { font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.hrow { display: flex; align-items: center; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.hrow:last-child { border-bottom: 0; }
.hd { flex: 1; min-width: 0; font-size: 12.5px; }
kbd { flex: none; font: 700 11px 'Montserrat', system-ui, sans-serif; padding: 3px 7px; border-radius: 5px; background: var(--raise); border: 1px solid #ffffff14; color: var(--text); white-space: nowrap; }
</style>
