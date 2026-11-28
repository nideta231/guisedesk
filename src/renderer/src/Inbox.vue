<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { presetFor } from '../../main/presets'
import { filterInbox, groupInbox, searchInbox, unreadCount } from '../../main/inbox'
import { initials } from './initials'

const props = defineProps<{ items: InboxItem[]; accounts: AccountRow[] }>()
const emit = defineEmits<{ close: []; select: [accountId: string, itemId: string]; 'read-all': []; clear: [] }>()

const filter = ref('')
const search = ref('')
const veil = ref<HTMLElement>()
onMounted(() => veil.value?.focus())

const byId = computed(() => new Map(props.accounts.map((a) => [a.id, a])))
const labels = computed(() => Object.fromEntries(props.accounts.map((a) => [a.id, a.label])))
const filtered = computed(() => searchInbox(filterInbox(props.items, filter.value || undefined), search.value, labels.value))
const groups = computed(() => groupInbox(filtered.value))
const unread = computed(() => unreadCount(props.items, props.accounts.filter((a) => a.muted).map((a) => a.id)))
// The filter lists accounts that actually have items, in the sidebar order.
const choices = computed(() => props.accounts.filter((a) => props.items.some((i) => i.accountId === a.id)))

const labelOf = (id: string) => byId.value.get(id)?.label ?? 'Account'
const serviceOf = (id: string) => {
  const a = byId.value.get(id)
  return a ? presetFor(a.serviceId)?.name ?? a.custom?.name ?? 'Custom site' : ''
}
const colourOf = (id: string) => byId.value.get(id)?.colour ?? '#6d5bd0'
const timeText = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div ref="veil" class="veil" tabindex="-1" @click.self="emit('close')" @keydown.esc.stop="emit('close')">
    <div class="glass inbox" role="dialog" aria-label="Notifications">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="emit('close')"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>Notifications</h3>
      <div class="bar">
        <select v-model="filter" class="inp filter" aria-label="Filter by account">
          <option value="">All accounts</option>
          <option v-for="a in choices" :key="a.id" :value="a.id">{{ a.label }} · {{ serviceOf(a.id) }}</option>
        </select>
        <input v-model="search" class="inp search" type="search" placeholder="Search notifications" aria-label="Search notifications" />
        <button class="btn" :disabled="!unread" @click="emit('read-all')">Mark all read</button>
        <button class="btn" :disabled="!items.length" @click="emit('clear')">Clear</button>
      </div>
      <div class="list">
        <template v-for="g in groups" :key="g.title">
          <div class="day">{{ g.title }}</div>
          <button
            v-for="i in g.items"
            :key="i.id"
            class="item"
            :class="{ unread: !i.read }"
            @click="emit('select', i.accountId, i.id)"
          >
            <span class="dot" :class="{ off: i.read }"></span>
            <span class="av" :style="{ background: colourOf(i.accountId) }">{{ initials(labelOf(i.accountId)) }}</span>
            <span class="content">
              <span class="meta"><b>{{ labelOf(i.accountId) }}</b><small>{{ serviceOf(i.accountId) }}</small><span class="time">{{ timeText(i.time) }}</span></span>
              <span class="title">{{ i.title }}</span>
              <span v-if="i.body" class="body">{{ i.body }}</span>
            </span>
          </button>
        </template>
        <div v-if="!groups.length" class="hint none">{{ search.trim() ? 'No notifications match.' : filter ? 'No notifications for this account.' : 'No notifications yet.' }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inbox { width: 560px; }
.bar { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; }
.filter, .search { flex: 1; min-width: 0; margin: 0; height: 32px; padding: 0 10px; font-size: 12.5px; }
.bar .btn { height: 32px; padding: 0 10px; font-size: 12px; white-space: nowrap; }
.bar .btn:disabled { opacity: 0.4; cursor: default; }
.list { max-height: 360px; overflow-y: auto; margin-top: 4px; }
.day { font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 12px 0 4px; }
.day:first-child { margin-top: 4px; }
.item { display: flex; align-items: flex-start; gap: 9px; width: 100%; text-align: left; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
.item:hover { background: #ffffff10; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; margin-top: 10px; }
.dot.off { background: transparent; box-shadow: inset 0 0 0 1px #ffffff2a; }
.item .av { width: 26px; height: 26px; font-size: 9.5px; }
.content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.meta { display: flex; align-items: baseline; gap: 6px; font-size: 11.5px; }
.meta b { font-weight: 700; }
.meta small { color: var(--muted); font-size: 10.5px; }
.meta .time { margin-left: auto; color: var(--dim); font-size: 10.5px; }
.title { font-weight: 700; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.body { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item:not(.unread) .title { font-weight: 600; color: var(--muted); }
.none { padding: 14px 8px; }
</style>
