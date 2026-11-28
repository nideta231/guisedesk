// Blur media hint (D42, D43). Plain TS, no electron: the CSS, the size rule and the DOM watcher (blur by rendered size, reveal on hover).
/** `items` switches to items mode (D47): whole elements matching them are blurred, never ones touching `exclude`. */
export interface BlurHint { container: string; items?: string[]; exclude?: string[]; parts?: Record<Part, string[]>; strength?: 'light' }
/** WhatsApp privacy blur parts (D48): each one has its own selectors and switch. */
export const PARTS = ['messages', 'previews', 'avatars', 'names'] as const
export type Part = (typeof PARTS)[number]

/** Parts that are on: a part with no stored flag is on. */
export function partsOn(flags?: Partial<Record<Part, boolean>>): Part[] {
  return PARTS.filter((p) => flags?.[p] !== false)
}

/** The item selectors to blur: the enabled parts of a parts hint, else the hint's items. */
export function selectorsFor(hint: BlurHint, enabled: readonly Part[]): string[] {
  if (!hint.parts) return hint.items ?? []
  return PARTS.filter((p) => enabled.includes(p)).flatMap((p) => hint.parts![p])
}

const MIN = 100
const HOVER_MS = 300
const MOVE_MS = 50
const SCAN_MS = 50

/** CSS that blurs media marked by the watcher until it is hovered. */
export function blurCss(strength?: 'light'): string {
  // Light (WhatsApp, D48 amendment): a filter on a text element is cut at its box (parents clip with overflow:hidden),
  // which reads as a blurred rectangle. Text instead turns into its own soft shadow, which dissolves at the glyphs;
  // images and video inside a blurred part keep a filter, with edges faded by a mask so they don't end in a hard box.
  if (strength === 'light') {
    const media = 'img[data-gd-blur]:not([data-gd-hover]), video[data-gd-blur]:not([data-gd-hover]), [data-gd-blur]:not([data-gd-hover]) img, [data-gd-blur]:not([data-gd-hover]) video'
    return [
      `[data-gd-blur]:not(img):not(video):not([data-gd-hover]), [data-gd-blur]:not(img):not(video):not([data-gd-hover]) * { -webkit-text-fill-color: transparent; text-shadow: 0 0 7px currentColor; transition: text-shadow 300ms ease-out, -webkit-text-fill-color 300ms ease-out; }`,
      `${media} { filter: blur(5px); -webkit-mask-image: linear-gradient(to right, transparent, #000 min(14px, 12%), #000 max(calc(100% - 14px), 88%), transparent), linear-gradient(to bottom, transparent, #000 min(14px, 12%), #000 max(calc(100% - 14px), 88%), transparent); -webkit-mask-composite: source-in; mask-image: linear-gradient(to right, transparent, #000 min(14px, 12%), #000 max(calc(100% - 14px), 88%), transparent), linear-gradient(to bottom, transparent, #000 min(14px, 12%), #000 max(calc(100% - 14px), 88%), transparent); mask-composite: intersect; transition: filter 300ms ease-out; }`,
      `[data-gd-blur][data-gd-hover], [data-gd-blur][data-gd-hover] * { transition: filter 400ms ease-out, text-shadow 400ms ease-out, -webkit-text-fill-color 400ms ease-out; }`
    ].join('\n')
  }
  return `[data-gd-blur]:not([data-gd-hover]) { filter: blur(${strength === 'light' ? 5 : 28}px); transition: filter 300ms ease-out; }\n[data-gd-blur][data-gd-hover] { filter: blur(0); transition: filter 400ms ease-out; }`
}

/** True for img, video and background tiles (tag 'bg') whose rendered box is at least 100x100. */
export function shouldBlur(box: { w: number; h: number }, tag: string): boolean {
  return ['img', 'video', 'bg'].includes(tag.toLowerCase()) && box.w >= MIN && box.h >= MIN
}

/**
 * The outermost elements of a set: any element with an ancestor in the same set is dropped. Each parent chain is
 * walked once (memoised), so a deep page of nested marks does not turn every scan into an O(n^2) pass.
 */
export function topLevel(found: Set<Element>): Set<Element> {
  if (found.size < 2) return found
  const nested = new Set<Element>()
  const hasFound = new Map<Element, boolean>()
  const insideFound = (start: Element): boolean => {
    const path: Element[] = []
    let cur: Element | null = start
    let verdict = false
    while (cur) {
      const known = hasFound.get(cur)
      if (known !== undefined) { verdict = known; break }
      path.push(cur)
      if (found.has(cur)) { verdict = true; break }
      cur = cur.parentElement
    }
    for (const e of path) hasFound.set(e, verdict)
    return verdict
  }
  for (const e of found) {
    const parent = e.parentElement
    if (parent && insideFound(parent)) nested.add(e)
  }
  if (!nested.size) return found
  const out = new Set(found)
  for (const e of nested) out.delete(e)
  return out
}

/** Reads main's `--gd-blur=<json>` argument. */
export function parseBlurHint(argv: string[]): BlurHint | null {
  const raw = argv.find((x) => x.startsWith('--gd-blur='))
  if (!raw) return null
  try {
    const h = JSON.parse(raw.slice('--gd-blur='.length))
    if (typeof h?.container !== 'string') return null
    const list = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null)
    const items = list(h.items), exclude = list(h.exclude)
    const parts = h.parts && PARTS.every((p) => list(h.parts[p])) ? (h.parts as Record<Part, string[]>) : null
    return { container: h.container, ...(items ? { items } : {}), ...(parts ? { parts } : {}), ...((items || parts) && exclude ? { exclude } : {}), ...(h.strength === 'light' ? { strength: 'light' as const } : {}) }
  } catch {
    return null
  }
}

/**
 * Marks big media inside the container with data-gd-blur (kept current by observers) and un-blurs what the pointer
 * rests on for 300 ms (data-gd-hover). elementsFromPoint is used so overlays above a photo do not block the hover.
 */
export function watchBlur(win: Window & typeof globalThis, hint: BlurHint, parts: readonly Part[] = PARTS): { stop: () => void; setParts: (p: readonly Part[]) => void } {
  const doc = win.document
  let enabled = parts
  const itemsMode = !!(hint.items || hint.parts)
  const marked = new Set<Element>()
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => schedule()) : null
  const observed = new WeakSet<Element>()

  const tagOf = (e: Element): string | null => {
    const t = e.tagName.toLowerCase()
    if (t === 'img' || t === 'video') return t
    return e instanceof win.HTMLElement && /url\(/.test(e.style.backgroundImage) && !e.textContent?.trim() ? 'bg' : null
  }
  const scanItems = (): Set<Element> => {
    const found = new Set<Element>()
    const skip = (hint.exclude ?? []).join(', ')
    const sels = selectorsFor(hint, enabled).map((i) => `${hint.container} ${i}`).join(', ')
    for (const e of sels ? doc.querySelectorAll(sels) : []) {
      if (skip && (e.closest(skip) || e.querySelector(skip))) continue
      found.add(e)
    }
    return found
  }
  const scan = () => {
    const found = itemsMode ? scanItems() : new Set<Element>()
    if (!itemsMode) {
      for (const e of doc.querySelectorAll(`${hint.container} img, ${hint.container} video, ${hint.container} [style*="background-image"]`)) {
        const tag = tagOf(e)
        if (!tag) continue
        if (ro && !observed.has(e)) { observed.add(e); ro.observe(e) }
        const r = e.getBoundingClientRect()
        if (shouldBlur({ w: r.width, h: r.height }, tag)) found.add(e)
      }
    }
    const top = topLevel(found)
    for (const e of marked) if (!top.has(e)) { e.removeAttribute('data-gd-blur'); e.removeAttribute('data-gd-hover'); marked.delete(e) }
    for (const e of top) if (!marked.has(e)) { e.setAttribute('data-gd-blur', ''); marked.add(e) }
  }
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => { if (scanTimer === null) scanTimer = setTimeout(() => { scanTimer = null; scan() }, SCAN_MS) }
  scan()
  const mo = new win.MutationObserver(schedule)
  mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src', 'srcset'] })

  let hovered: Element[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const unhover = () => { for (const e of hovered) e.removeAttribute('data-gd-hover'); hovered = [] }
  let pending: { x: number; y: number } | null = null
  let last = -Infinity
  let moveTimer: ReturnType<typeof setTimeout> | null = null
  const probe = (x: number, y: number) => {
    const stack = doc.elementsFromPoint(x, y)
    // Some sites give media pointer-events none (Threads), so it is missing from the stack: use the box that holds it.
    const under = [...marked].filter((e) => {
      const r = e.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
      if (stack.includes(e)) return true
      let box = e.parentElement
      while (box && !(box.getBoundingClientRect().width > 0 && box.getBoundingClientRect().height > 0)) box = box.parentElement
      return !!box && stack.includes(box)
    })
    if (under.length === hovered.length && under.every((e) => hovered.includes(e))) return
    if (timer) clearTimeout(timer)
    timer = null
    unhover()
    if (!under.length) return
    hovered = under
    timer = setTimeout(() => { timer = null; for (const e of hovered) e.setAttribute('data-gd-hover', '') }, HOVER_MS)
  }
  const onMove = (ev: Event) => {
    const m = ev as MouseEvent
    pending = { x: m.clientX, y: m.clientY }
    const wait = last + MOVE_MS - Date.now()
    if (wait <= 0) { last = Date.now(); const p = pending; pending = null; probe(p.x, p.y) }
    else if (moveTimer === null) moveTimer = setTimeout(() => { moveTimer = null; last = Date.now(); if (pending) { const p = pending; pending = null; probe(p.x, p.y) } }, wait)
  }
  const onLeave = () => { if (timer) clearTimeout(timer); timer = null; unhover() }
  win.addEventListener('pointermove', onMove, { capture: true, passive: true })
  doc.documentElement.addEventListener('mouseleave', onLeave)

  return {
    setParts(p) { enabled = p; scan() },
    stop() {
      mo.disconnect()
      ro?.disconnect()
      win.removeEventListener('pointermove', onMove, { capture: true })
      doc.documentElement.removeEventListener('mouseleave', onLeave)
      for (const t of [scanTimer, timer, moveTimer]) if (t) clearTimeout(t)
      for (const e of marked) { e.removeAttribute('data-gd-blur'); e.removeAttribute('data-gd-hover') }
      marked.clear()
    }
  }
}
