<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CUSTOM_PRESET_ID, PRESETS, presetFor } from '../../main/presets'
import { defaultShare, shareHosts } from '../../main/sharing'
import { validateNewAccount, type NewAccountInput } from '../../main/validate'
import LogoGlyph from './LogoGlyph.vue'
import { logoStyle } from './logos'

const props = defineProps<{ serverError?: string; accounts?: { id: string; serviceId: string; label: string; shareWith?: string }[] }>()
const emit = defineEmits<{ add: [input: NewAccountInput]; cancel: [] }>()

const COLOURS = ['#6d5bd0', '#c7772a', '#2f7fb6', '#2b8a6e', '#b04c7a', '#4a5bc4']
// Grid order follows the mockup (Discord last before Custom URL), not the preset list order.
const ORDER = ['whatsapp', 'instagram', 'facebook', 'x', 'threads', 'tiktok', 'discord']
const services = [
  ...ORDER.map((id) => ({ id, name: presetFor(id)!.name })),
  { id: CUSTOM_PRESET_ID, name: 'Custom URL' }
]

const serviceId = ref(PRESETS[0].id)
const label = ref('')
const colour = ref(COLOURS[0])
const cname = ref('')
const curl = ref('')
const error = ref('')
// Login choice (D36): only for a Meta service with other-service accounts to share with. undefined = Separate.
const hosts = computed(() => shareHosts(serviceId.value, props.accounts ?? []))
const share = ref<string | undefined>(defaultShare(serviceId.value, props.accounts ?? []))
watch(serviceId, (id) => (share.value = defaultShare(id, props.accounts ?? [])))
const hostText = (a: { serviceId: string; label: string }) => `Same as ${a.label} (${presetFor(a.serviceId)?.name ?? a.serviceId})`

const isCustom = computed(() => serviceId.value === CUSTOM_PRESET_ID)
const hint = computed(() => {
  const p = presetFor(serviceId.value)
  const name = p?.name ?? 'A custom site'
  return p?.kind === 'chat'
    ? `${name} is a chat: it stays on so notifications arrive. You can change that later.`
    : `${name} is a feed: it sleeps after 30 minutes unused to save memory. You can change that later.`
})

function submit() {
  const input: NewAccountInput = {
    serviceId: serviceId.value,
    label: label.value,
    colour: colour.value,
    ...(share.value && hosts.value.some((h) => h.id === share.value) ? { shareWith: share.value } : {}),
    ...(isCustom.value ? { custom: { name: cname.value, url: curl.value } } : {})
  }
  const v = validateNewAccount(input)
  if (!v.ok) {
    error.value = v.error
    return
  }
  error.value = ''
  const { serviceId: sid, label: l, colour: c, custom, shareWith } = v.value
  emit('add', { serviceId: sid, label: l, colour: c, ...(shareWith ? { shareWith } : {}), ...(custom ? { custom: { name: custom.name, url: custom.url } } : {}) })
}
</script>

<template>
  <div class="veil" @click.self="emit('cancel')">
    <div class="glass" role="dialog" aria-label="Add an account">
      <button class="ib x" title="Close (Esc)" aria-label="Close" @click="emit('cancel')"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h3>Add an account</h3>
      <p class="sub">Each account gets its own sealed session. You'll log in inside GuiseDesk right after.</p>
      <div class="pick" role="radiogroup" aria-label="Service">
        <button
          v-for="s in services"
          :key="s.id"
          type="button"
          role="radio"
          :aria-checked="s.id === serviceId"
          class="pk"
          :class="{ sel: s.id === serviceId }"
          @click="serviceId = s.id"
          @keydown.enter.prevent="serviceId = s.id"
        >
          <div class="lg" :style="logoStyle(s.id)"><LogoGlyph :service-id="s.id" /></div>{{ s.name }}
        </button>
      </div>
      <template v-if="isCustom">
        <div class="lbl">Name</div>
        <input v-model="cname" class="inp cname" placeholder="Team wiki" />
        <div class="lbl">URL</div>
        <input v-model="curl" class="inp curl" placeholder="https://wiki.example.com/" />
      </template>
      <div class="lbl">Label</div>
      <input v-model="label" class="inp label" placeholder="Business" @keydown.enter="submit" />
      <template v-if="hosts.length">
        <div class="lbl">Login</div>
        <div class="seg login">
          <span :class="{ sel: !share }" @click="share = undefined">Separate</span>
          <span v-for="h in hosts" :key="h.id" :class="{ sel: share === h.id }" @click="share = h.id">{{ hostText(h) }}</span>
        </div>
      </template>
      <div class="lbl">Colour</div>
      <div class="sw" role="radiogroup" aria-label="Colour">
        <button
          v-for="(c, n) in COLOURS"
          :key="c"
          type="button"
          role="radio"
          :aria-checked="c === colour"
          :aria-label="'Colour ' + (n + 1)"
          :class="{ sel: c === colour }"
          :style="{ background: c }"
          @click="colour = c"
          @keydown.enter.prevent="colour = c"
        ></button>
      </div>
      <div class="hint">{{ hint }}</div>
      <div v-if="error || props.serverError" class="err">{{ error || props.serverError }}</div>
      <div class="btns">
        <button class="btn" @click="emit('cancel')">Cancel</button>
        <button class="btn pri" @click="submit">Add &amp; open</button>
      </div>
    </div>
  </div>
</template>
