import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal focus for every dialog (UX-039): remembers the element that had focus, moves focus to the first field
 * (or the X button), keeps Tab/Shift+Tab inside `.glass`, and gives focus back on unmount.
 */
export function useDialogFocus(glass: Ref<HTMLElement | undefined>) {
  let previous: HTMLElement | null = null
  const focusables = (): HTMLElement[] => {
    const root = glass.value
    return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
  }
  function focusFirst() {
    const els = focusables()
    const field = els.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))
    const x = els.find((el) => el.classList.contains('x'))
    ;(field ?? x ?? els[0] ?? glass.value)?.focus()
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab') return
    const els = focusables()
    const root = glass.value
    if (!els.length) {
      e.preventDefault()
      root?.focus()
      return
    }
    const first = els[0]
    const last = els[els.length - 1]
    const active = document.activeElement as HTMLElement | null
    const outside = !root || !active || !root.contains(active)
    if (e.shiftKey) {
      if (active === first || outside) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || outside) {
      e.preventDefault()
      first.focus()
    }
  }
  onMounted(() => {
    previous = document.activeElement as HTMLElement | null
    void nextTick(() => {
      focusFirst()
      glass.value?.addEventListener('keydown', onKey)
    })
  })
  onBeforeUnmount(() => {
    glass.value?.removeEventListener('keydown', onKey)
    previous?.focus?.()
  })
  return { focusFirst }
}
