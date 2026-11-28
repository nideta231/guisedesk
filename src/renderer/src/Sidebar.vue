<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { kindOf, presetFor } from '../../main/presets'
import BrandMark from './BrandMark.vue'
import LogoGlyph from './LogoGlyph.vue'
import { logoStyle } from './logos'
import { initials } from './initials'
import { formatCount } from '../../main/unread'
import { version } from '../../../package.json'
import { SIDE_MAX, SIDE_MIN, sideWidth } from '../../main/layout'
import { sidebarGroups } from '../../main/services'

interface Acc {
  id: string; serviceId: string; label: string; colour: string; order: number; muted?: boolean
  custom?: { name: string; url: string; icon?: string }
}
const props = defineProps<{ accounts: Acc[]; selectedId?: string; counts?: Record<string, number>; asleep?: string[]; collapsed?: boolean; update?: boolean; width?: number; inboxUnread?: number }>()
const emit = defineEmits<{ select: [id: string]; add: []; settings: []; account: [id: string]; mute: [id: string, muted: boolean]; sleep: [id: string]; toggle: []; update: []; reorder: [ids: string[]] ; hide: []; resize: [width: number]; inbox: [] }>()

const groups = computed(() => sidebarGroups(props.accounts))

// Drag to reorder (D28): only within a group. The dragged row takes the target's place; the line shows which side it lands on.
const dragId = ref<string | undefined>()
const over = ref<{ id: string; at: 'before' | 'after' } | undefined>()
const sorted = () => [...props.accounts].sort((a, b) => a.order - b.order).map((a) => a.id)
const sameGroup = (a: Acc, b: Acc) => kindOf(a.serviceId) === kindOf(b.serviceId)
const dragged = () => props.accounts.find((x) => x.id === dragId.value)
function dragStart(e: DragEvent, a: Acc) {
  dragId.value = a.id
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function dragOver(e: DragEvent, a: Acc) {
  const d = dragged()
  if (!d || d.id === a.id || !sameGroup(d, a)) {
    over.value = undefined
    return
  }
  e.preventDefault()
  const ids = sorted()
  over.value = { id: a.id, at: ids.indexOf(d.id) < ids.indexOf(a.id) ? 'after' : 'before' }
}
function dragEnd() {
  dragId.value = undefined
  over.value = undefined
}
function drop(a: Acc) {
  const d = dragged()
  if (d && d.id !== a.id && sameGroup(d, a)) {
    const all = sorted()
    const ids = all.filter((id) => id !== d.id)
    ids.splice(ids.indexOf(a.id) + (all.indexOf(d.id) < all.indexOf(a.id) ? 1 : 0), 0, d.id)
    emit('reorder', ids)
  }
  dragEnd()
}

const serviceName = (a: Acc) => presetFor(a.serviceId)?.name ?? 'Custom'
// In the rail the name is only a tooltip.
// Drag the right edge to resize (D52): live width while dragging, saved by main on release.
const dragW = ref<number | null>(null)
function startDrag(ev: PointerEvent) {
  if (props.collapsed) return
  const x0 = ev.clientX
  const w0 = sideWidth(false, props.width)
  const move = (e: PointerEvent) => (dragW.value = Math.min(SIDE_MAX, Math.max(SIDE_MIN, w0 + e.clientX - x0)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (dragW.value !== null) emit('resize', dragW.value)
    dragW.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
const tip = (a: Acc) => (props.collapsed ? `${a.label} · ${serviceName(a)}` : undefined)

// Right-click menu (D19, D27, D41): main pops up a native menu (it must draw over the service view) and sends the pick back.
const openCtx = (_e: MouseEvent, a: Acc) => window.guisedesk.rowMenu(a.id)
let offRowMenu: Unsubscribe = () => {}
onMounted(() => {
  offRowMenu = window.guisedesk.onRowMenuPick(({ id, action }) => {
    if (action === 'mute') emit('mute', id, !props.accounts.find((a) => a.id === id)?.muted)
    else if (action === 'sleep') emit('sleep', id)
    else if (action === 'account') emit('account', id)
  })
})
onBeforeUnmount(() => offRowMenu?.())
</script>

<template>
  <aside class="side" :class="{ mini: collapsed }" :style="{ width: (dragW ?? sideWidth(!!collapsed, width)) + 'px' }">
    <div class="brand"><BrandMark :size="collapsed ? 32 : 26" /><span v-if="!collapsed" class="bn">GuiseDesk</span><button class="ib gear" title="Settings" aria-label="Settings" @click="emit('settings')"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></button><button class="ib add" title="Add account" @click="emit('add')"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button></div>
    <div v-for="g in groups" :key="g.title" class="group">
      <div class="sec">{{ collapsed ? '' : g.title }}</div>
      <div
        v-for="a in g.rows"
        :key="a.id"
        class="row"
        :class="{ on: a.id === selectedId, sleep: asleep?.includes(a.id), 'drop-before': over?.id === a.id && over.at === 'before', 'drop-after': over?.id === a.id && over.at === 'after' }"
        :title="tip(a)"
        draggable="true"
        @dragstart="dragStart($event, a)"
        @dragover="dragOver($event, a)"
        @drop.prevent="drop(a)"
        @dragend="dragEnd"
        @click="emit('select', a.id)"
        @contextmenu.prevent="openCtx($event, a)"
      >
        <span class="av" :style="{ background: a.colour }">{{ initials(a.label) }}<span class="svc" :style="logoStyle(a.serviceId)"><LogoGlyph :service-id="a.serviceId" :icon="a.custom?.icon" /></span></span>
        <span v-if="!collapsed" class="name">{{ a.label }}<small>{{ serviceName(a) }}<template v-if="a.muted"> · muted</template></small></span>
        <span v-if="asleep?.includes(a.id)" class="zz">ZZ</span><span v-else-if="(counts?.[a.id] ?? 0) > 0" class="count" :class="{ muted: a.muted }">{{ formatCount(counts![a.id]) }}</span><span v-else-if="!collapsed" class="slot"></span>
      </div>
    </div>
    <div class="grow"></div>
    <div class="foot"><button class="ib tgl" :title="collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'" :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'" @click="emit('toggle')"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg><i v-if="update && collapsed" class="upd dot" title="Update available" @click.stop="emit('update')"></i></button><button class="ib bell" :title="inboxUnread ? inboxUnread + ' unread notifications' : 'Notifications'" aria-label="Notifications" @click="emit('inbox')"><svg class="i" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg><span v-if="(inboxUnread ?? 0) > 0" class="badge">{{ formatCount(inboxUnread!) }}</span></button><button class="ib hide" title="Hide sidebar (Ctrl+B brings it back)" aria-label="Hide sidebar" @click="emit('hide')"><svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button><span v-if="!collapsed" class="ver">GuiseDesk v{{ version }}</span><button v-if="update && !collapsed" class="upd" title="Update available" @click="emit('update')">Update</button></div>
    <div v-if="!collapsed" class="grip" title="Drag to resize" @pointerdown.prevent="startDrag"></div>
  </aside>
</template>

<style scoped>
.foot { gap: 8px; }
.foot .ver { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot .bell { position: relative; flex: none; }
.foot .bell .badge { position: absolute; right: -4px; top: -5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 9.5px; font-weight: 700; line-height: 16px; text-align: center; box-shadow: 0 0 0 2px var(--side); }
.side.mini .foot .bell .badge { right: -5px; top: -5px; }
</style>
