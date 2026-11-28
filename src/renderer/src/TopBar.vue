<script setup lang="ts">
import { computed } from 'vue'
import { limitMinutes } from '../../main/hibernate'
import { presetFor } from '../../main/presets'
import { parseProxy, proxyLabel } from '../../main/proxy'
import { zoomPercent } from '../../main/shortcuts'

const props = defineProps<{
  account: { id: string; serviceId: string; label: string; muted?: boolean; idlePolicy?: string; zoom?: number; custom?: { name: string } }
  asleep: boolean
  /** Ad blocking on (D45): the shield chip shows `blocked`; no chip when off. */
  adsOn?: boolean
  blocked?: number
  /** A dropped pop-up URL (D45): the "Pop-up blocked" chip; clicking it opens the URL anyway. */
  popup?: string
  /** Lock countdown (D57): time left under the active idle/schedule rule; null or missing = no chip. */
  lock?: { ms: number; rule: string } | null
  /** Proxy address in effect (D63), without credentials; missing = Direct. */
  proxy?: string
  /** Split view (D62): the second account sits next to this one. */
  split?: boolean
  /** Page history (UX-013): Back and Forward are enabled only in that direction. */
  nav?: { canBack: boolean; canForward: boolean }
}>()
const emit = defineEmits<{ reload: []; home: []; back: []; forward: []; mute: [muted: boolean]; lock: []; sleep: []; settings: []; 'reset-zoom': []; 'open-popup': []; shield: []; extensions: []; 'lock-menu': []; 'proxy-menu': []; 'split-menu': []; 'close-split': [] }>()

const service = computed(() => presetFor(props.account.serviceId)?.name ?? props.account.custom?.name ?? props.account.serviceId)
// One chip: asleep, then muted, then always on (live chat or an always-on override); a live feed account has none.
const chip = computed(() => {
  if (props.asleep) return 'Asleep'
  if (props.account.muted) return 'Muted'
  return limitMinutes(props.account) === null ? 'Always on' : ''
})
// Whole minutes left, rounded up, so the chip never says "0 min" while the lock is still ahead.
// The label stays short (D57): the full rule is in the title and the native menu.
const lockText = computed(() => {
  const ms = props.lock?.ms
  if (ms === undefined || ms === null) return ''
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`
})
// host:port only, so the chip never shows a proxy password even if one were in the address (D63).
const proxyText = computed(() => {
  if (!props.proxy) return ''
  const p = parseProxy(props.proxy)
  return p.ok ? proxyLabel(p.value) : props.proxy
})
</script>

<template>
  <div class="top">
    <div class="title">{{ account.label }} <span>&middot; {{ service }}</span></div>
    <span v-if="chip" class="chip" :class="{ live: chip === 'Always on' }">{{ chip }}</span>
    <button v-if="lockText" class="chip locks nowrap" :title="lock?.rule" @click="emit('lock-menu')"><svg class="i locki" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>{{ lockText }}</button>
    <button v-if="proxy" class="chip proxy" :title="'Proxy: ' + proxyText" @click="emit('proxy-menu')">Proxy</button>
    <button v-if="account.zoom" class="chip zoom" title="Reset zoom" @click="emit('reset-zoom')">{{ zoomPercent(account.zoom) }}%</button>
    <button v-if="adsOn && !asleep" class="chip shield" title="Ads and trackers blocked" aria-label="Ads and trackers blocked" @click="emit('shield')"><svg class="i" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>{{ blocked ?? 0 }}</button>
    <button v-if="popup && !asleep" class="chip popup" :title="'Open anyway: ' + popup" @click="emit('open-popup')">Pop-up blocked</button>
    <button v-if="!asleep && split" class="split splitbtn" title="Close split view" @click="emit('close-split')">Close split</button>
    <button v-else-if="!asleep" class="split splitbtn" title="Show a second account side by side" @click="emit('split-menu')">Split</button>
    <button v-if="!asleep" class="extbtn" title="Extensions" aria-label="Extensions" @click="emit('extensions')"><svg class="i" viewBox="0 0 24 24"><path d="M10 3h4v3a2 2 0 1 0 4 0V3h0a1 1 0 0 1 1 1v5h-3a2 2 0 1 0 0 4h3v6a1 1 0 0 1-1 1h-5v-3a2 2 0 1 0-4 0v3H4a1 1 0 0 1-1-1v-6h3a2 2 0 1 0 0-4H3V4a1 1 0 0 1 1-1h6z" /></svg></button>
    <div class="nav">
      <button class="ib home" title="Home" aria-label="Home" @click="emit('home')"><svg class="i" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg></button>
      <button class="ib back" title="Back" aria-label="Back" :disabled="!nav?.canBack" @click="emit('back')"><svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
      <button class="ib forward" title="Forward" aria-label="Forward" :disabled="!nav?.canForward" @click="emit('forward')"><svg class="i" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
    </div>
    <div class="actions">
      <button class="ib" title="Reload" aria-label="Reload" @click="emit('reload')"><svg class="i" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg></button>
      <button v-if="account.muted" class="ib" title="Unmute" aria-label="Unmute" @click="emit('mute', false)"><svg class="i" viewBox="0 0 24 24"><path d="M8.7 3A6 6 0 0 1 18 8c0 3 .5 5.2 1.2 6.8M17 17H3s3-2 3-9c0-.8.1-1.5.4-2.2" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0M2 2l20 20" /></svg></button>
      <button v-else class="ib" title="Mute" aria-label="Mute" @click="emit('mute', true)"><svg class="i" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg></button>
      <button v-if="!asleep" class="ib" title="Sleep now" aria-label="Sleep now" @click="emit('sleep')"><svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg></button>
      <button class="ib" title="Lock now" aria-label="Lock now" @click="emit('lock')"><svg class="i" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></button>
      <button class="ib" title="Settings" aria-label="Settings" @click="emit('settings')"><svg class="i" viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg></button>
    </div>
  </div>
</template>

<style scoped>
.nav { display: flex; gap: 6px; margin-left: 10px; }
.nav .ib:disabled, .nav .ib:disabled:hover { opacity: .35; color: var(--muted); background: transparent; cursor: default; }
.shield { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.shield .i { width: 12px; height: 12px; }
.popup { cursor: pointer; }
.locks { display: inline-flex; align-items: center; gap: 4px; flex: none; cursor: pointer; border: 0; font-family: inherit; }
.locks:hover { color: var(--text); }
.locks .locki { width: 11px; height: 11px; }
.nowrap { white-space: nowrap; }
.proxy { border: 0; cursor: pointer; font-family: inherit; flex: none; white-space: nowrap; }
.proxy:hover { color: var(--text); }
.splitbtn { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; padding: 4px 9px; border-radius: 6px; background: var(--raise); color: var(--muted); border: 0; font-family: inherit; white-space: nowrap; flex: none; }
.splitbtn:hover { color: var(--text); }
.extbtn { display: inline-flex; align-items: center; margin-left: 6px; padding: 4px 7px; border: 0; border-radius: 6px; background: var(--raise); color: var(--muted); cursor: pointer; }
.extbtn:hover { color: var(--text); }
.extbtn .i { width: 13px; height: 13px; }
</style>
