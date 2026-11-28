<script setup lang="ts">
import { ref } from 'vue'
import { presetFor } from '../../main/presets'
import { initials } from './initials'
import { useDialogFocus } from './useDialogFocus'

defineProps<{ url: string; candidates: { id: string; label: string; colour: string; serviceId: string }[] }>()
const emit = defineEmits<{ choose: [choice: string | null] }>()
const glass = ref<HTMLElement>()
useDialogFocus(glass)

const short = (u: string) => (u.length > 56 ? u.slice(0, 55) + '…' : u)
const serviceName = (id: string) => presetFor(id)?.name ?? 'Custom site'
</script>

<template>
  <div class="veil" tabindex="-1" @keydown.esc.stop="emit('choose', null)" @click.self="emit('choose', null)">
    <div ref="glass" class="glass" role="dialog" aria-modal="true" aria-label="Open link in">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="emit('choose', null)"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>Open link in</h3>
      <p class="sub url">{{ short(url) }}</p>
      <div class="row" v-for="c in candidates" :key="c.id" @click="emit('choose', c.id)">
        <div class="av" :style="{ background: c.colour }">{{ initials(c.label) }}</div>
        <div class="nm">{{ c.label }}</div>
        <div class="svcn">{{ serviceName(c.serviceId) }}</div>
      </div>
      <div class="btns">
        <button class="btn" @click="emit('choose', 'browser')">Open in browser</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.url { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.row:hover { background: #ffffff10; }
.nm { font-weight: 600; flex: 1; }
.svcn { color: var(--muted); font-size: 12.5px; }
</style>
