<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { isSettingsTab, SETTINGS_TABS } from '../../main/settingsTabs'
import SettingsExtensions from './SettingsExtensions.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsLock from './SettingsLock.vue'
import SettingsNotifications from './SettingsNotifications.vue'
import SettingsServices from './SettingsServices.vue'

const props = defineProps<{ accounts: AccountRow[]; disabled: string[]; update?: UpdateInfo; tab?: string }>()
const emit = defineEmits<{ back: []; toggle: [serviceId: string, enabled: boolean]; open: [id: string]; unmute: [id: string]; reset: []; check: []; apply: []; shortcuts: [] }>()

const TABS: string[] = [...SETTINGS_TABS]
// Dev-only: the screenshot hook opens a tab with ?tab=Lock.
const first = new URLSearchParams(location.search).get('tab') ?? ''
const explicit = isSettingsTab(props.tab) ? props.tab : undefined
const fromQuery = isSettingsTab(first) ? first : undefined
const tab = ref<string>(explicit ?? fromQuery ?? 'Services')
watch(() => props.tab, (t) => isSettingsTab(t) && (tab.value = t))

// Keyboard tabs (UX-005): each tab is a real button with the ARIA tab pattern.
const tabEls = ref<HTMLButtonElement[]>([])
function focusTab() {
  void nextTick(() => tabEls.value[TABS.indexOf(tab.value)]?.focus())
}
onMounted(async () => {
  focusTab()
  // UX-006: only when nothing (the tray, the shield menu, the dev hook) asked for a tab, reopen the last one used.
  if (explicit || fromQuery) return
  const last = await window.guisedesk?.lastSettingsTab?.()
  if (isSettingsTab(last)) tab.value = last
})
watch(tab, (t) => {
  focusTab()
  void window.guisedesk?.saveLastSettingsTab?.(t)
})
function onTabKey(e: KeyboardEvent) {
  const i = TABS.indexOf(tab.value)
  let next = i
  if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
  else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = TABS.length - 1
  else return
  e.preventDefault()
  tab.value = TABS[next]
}
</script>

<template>
  <section class="settings">
    <div class="top"><button class="ib" title="Back" aria-label="Back" @click="emit('back')"><svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button><div class="title">Settings</div><button class="ib x close" title="Close (Esc)" aria-label="Close" @click="emit('back')"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
    <div class="tabs" role="tablist" @keydown="onTabKey">
      <button v-for="t in TABS" :key="t" ref="tabEls" type="button" role="tab" :aria-selected="t === tab" :tabindex="t === tab ? 0 : -1" :class="{ sel: t === tab }" @click="tab = t">{{ t }}</button>
    </div>
    <SettingsServices v-if="tab === 'Services'" :accounts="accounts" :disabled="disabled" @toggle="(s, on) => emit('toggle', s, on)" @open="(id) => emit('open', id)" />
    <SettingsLock v-else-if="tab === 'Lock'" @reset="emit('reset')" />
    <SettingsNotifications v-else-if="tab === 'Notifications'" :accounts="accounts" @unmute="(id) => emit('unmute', id)" />
    <SettingsExtensions v-else-if="tab === 'Extensions'" :accounts="accounts" />
    <SettingsGeneral v-else :update="update ?? { state: 'checking' }" @check="emit('check')" @apply="emit('apply')" @shortcuts="emit('shortcuts')" />
  </section>
</template>
