<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { initials } from './initials'

const props = defineProps<{ accounts: AccountRow[] }>()
const emit = defineEmits<{ unmute: [id: string]; opentab: [tab: string] }>()
const dnd = ref(false)
const quiet = ref(false)
const muted = computed(() => props.accounts.filter((a) => a.muted))

let offDnd: Unsubscribe = () => {}
onMounted(async () => {
  const p = await window.guisedesk.prefs()
  dnd.value = p.dnd
  quiet.value = !!p.quietWorkHours
  // The tray checkbox changes the same setting.
  offDnd = window.guisedesk.onDnd((on) => (dnd.value = on))
})
onBeforeUnmount(() => offDnd?.())

async function toggle() {
  const on = !dnd.value
  if (await window.guisedesk.setDnd(on)) dnd.value = on
}

async function toggleQuiet() {
  const on = !quiet.value
  if (await window.guisedesk.setQuietWorkHours(on)) quiet.value = on
}
</script>

<template>
  <div class="cards">
    <div class="card">
      <h4>Do Not Disturb</h4>
      <div class="sr">
        <span class="t"><b>Do Not Disturb</b><span>No pop-ups from any account. Badges keep counting. Also in the tray menu.</span></span>
        <button class="tg" :class="{ on: dnd }" role="switch" :aria-checked="dnd" aria-label="Do Not Disturb" @click="toggle"></button>
      </div>
      <div class="sr">
        <span class="t"><b>Quiet outside work hours</b><span>Uses the work days and hours from Settings &gt; Lock. Notifications are dropped outside them.</span></span>
        <button class="btn workhours" @click="emit('opentab', 'Lock')">Change work hours</button>
        <button class="tg" :class="{ on: quiet }" role="switch" :aria-checked="quiet" aria-label="Quiet outside work hours" @click="toggleQuiet"></button>
      </div>
    </div>
    <div class="card">
      <h4>Muted accounts</h4>
      <div v-if="!muted.length" class="sr"><span class="t"><span>No muted accounts</span></span></div>
      <div v-for="a in muted" :key="a.id" class="ar mu">
        <span class="av" :style="{ background: a.colour }">{{ initials(a.label) }}</span>
        <span class="al">{{ a.label }}</span>
        <button class="btn" @click="emit('unmute', a.id)">Unmute</button>
      </div>
    </div>
  </div>
</template>
