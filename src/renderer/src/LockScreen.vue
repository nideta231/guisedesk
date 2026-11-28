<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BrandMark from './BrandMark.vue'

const props = defineProps<{ kind: 'pin' | 'password'; pinLength?: number; waitUntil?: number }>()
const emit = defineEmits<{ forgot: [] }>()

const entry = ref('')
const shake = ref(false)
const busy = ref(false)
const until = ref(props.waitUntil ?? 0)
const now = ref(Date.now())
const waiting = computed(() => until.value > now.value)
const secs = computed(() => Math.max(1, Math.ceil((until.value - now.value) / 1000)))
const length = computed(() => props.pinLength ?? 6)
const errorText = ref('')
let timer: ReturnType<typeof setInterval> | undefined
let errorTimer: ReturnType<typeof setTimeout> | undefined

function clearError() {
  errorText.value = ''
  if (errorTimer) {
    clearTimeout(errorTimer)
    errorTimer = undefined
  }
}

// A wrong entry is named (UX-027) instead of only shaking; a wait result always replaces it.
function showWrong() {
  errorText.value = props.kind === 'pin' ? 'Wrong PIN. Try again.' : 'Wrong password. Try again.'
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(clearError, 4000)
}

function tick() {
  now.value = Date.now()
  if (!waiting.value && timer) {
    clearInterval(timer)
    timer = undefined
  }
}
function startTimer() {
  now.value = Date.now()
  if (!timer && waiting.value) timer = setInterval(tick, 250)
}

async function submit() {
  if (busy.value || waiting.value || !entry.value) return
  const value = entry.value
  busy.value = true
  try {
    const r = await window.guisedesk.unlock(value)
    if (r.result === 'ok') return
    entry.value = ''
    shake.value = true
    setTimeout(() => (shake.value = false), 400)
    if (r.result === 'wait') {
      clearError()
      until.value = r.until
      startTimer()
    } else {
      showWrong()
    }
  } finally {
    busy.value = false
  }
}

function digit(d: string) {
  if (busy.value || waiting.value || entry.value.length >= length.value) return
  clearError()
  entry.value += d
  if (entry.value.length === length.value) void submit()
}
const del = () => {
  if (!busy.value && !waiting.value) {
    clearError()
    entry.value = entry.value.slice(0, -1)
  }
}

function onKey(e: KeyboardEvent) {
  if (props.kind !== 'pin' || e.ctrlKey || e.altKey || e.metaKey) return
  if (/^\d$/.test(e.key)) digit(e.key)
  else if (e.key === 'Backspace') del()
  else if (e.key === 'Enter') void submit()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  startTimer()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (timer) clearInterval(timer)
  if (errorTimer) clearTimeout(errorTimer)
})
</script>

<template>
  <div class="lockv" :class="{ shake }">
    <div>
      <div class="brand"><BrandMark :size="40" />GuiseDesk</div>
      <div class="hint">Locked &middot; your accounts are still running</div>
      <template v-if="kind === 'pin'">
        <div class="dots"><i v-for="n in length" :key="n" :class="{ f: n <= entry.length }"></i></div>
        <div class="pad">
          <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="d" :disabled="waiting" @click="digit(d)">{{ d }}</button>
          <button class="gh" @click="emit('forgot')">Forgot</button>
          <button :disabled="waiting" @click="digit('0')">0</button>
          <button class="gh" :disabled="waiting" @click="del">Delete</button>
        </div>
      </template>
      <div v-else class="pw">
        <input v-model="entry" class="inp" type="password" autofocus placeholder="Password" :disabled="waiting" aria-label="Password" @input="clearError" @keydown.enter="submit" />
        <div class="pwbtns"><button class="btn" @click="emit('forgot')">Forgot</button><button class="btn pri" :disabled="waiting" @click="submit">Unlock</button></div>
      </div>
      <div v-if="errorText && !waiting" class="wrong" role="alert">{{ errorText }}</div>
      <div v-if="waiting" class="wait" role="status">Too many tries. Try again in {{ secs }} s</div>
    </div>
  </div>
</template>
