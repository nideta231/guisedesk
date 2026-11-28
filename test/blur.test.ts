// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { blurCss, parseBlurHint, partsOn, selectorsFor, shouldBlur, topLevel, watchBlur } from '../src/preload/blur'
import { addAccount, loadAccounts, setBlurMedia, setBlurPart } from '../src/main/accounts'
import { PRESETS } from '../src/main/presets'
import AccountSheet from '../src/renderer/src/AccountSheet.vue'

const hint = { container: 'article' }

describe('blurCss and the hint argument', () => {
  it('blurs marked media until hovered, with no per-site media selectors', () => {
    const css = blurCss()
    expect(css).toContain('[data-gd-blur]:not([data-gd-hover])')
    expect(css).toContain('filter: blur(28px)')
    expect(css).toContain('[data-gd-blur][data-gd-hover]')
    expect(css).toContain('filter: blur(0)')
    expect(css).toContain('transition: filter 400ms ease-out')
    expect(css).toContain('transition: filter 300ms ease-out')
    expect(css).not.toContain('cursor: pointer')
  })
  it('parses main argument (container only)', () => {
    expect(parseBlurHint(['--gd-blur=' + JSON.stringify({ container: 'article', media: 'img', skip: 'x' })])).toEqual(hint)
    expect(parseBlurHint(['--gd-blur=' + JSON.stringify({ container: '#app', items: ['a'], exclude: ['b'] })])).toEqual({ container: '#app', items: ['a'], exclude: ['b'] })
    expect(parseBlurHint(['--gd-service'])).toBeNull()
    expect(parseBlurHint(['--gd-blur=nope'])).toBeNull()
  })
})

describe('shouldBlur', () => {
  it('blurs img, video and background tiles of at least 100x100, never smaller ones or other tags', () => {
    expect(shouldBlur({ w: 224, h: 280 }, 'IMG')).toBe(true)
    expect(shouldBlur({ w: 100, h: 100 }, 'video')).toBe(true)
    expect(shouldBlur({ w: 300, h: 200 }, 'bg')).toBe(true)
    expect(shouldBlur({ w: 40, h: 40 }, 'IMG')).toBe(false)
    expect(shouldBlur({ w: 500, h: 99 }, 'IMG')).toBe(false)
    expect(shouldBlur({ w: 0, h: 0 }, 'PICTURE')).toBe(false)
    expect(shouldBlur({ w: 500, h: 500 }, 'PICTURE')).toBe(false)
  })
})

describe('topLevel', () => {
  it('keeps only the outermost of 200 nested marks and visits each parent once', () => {
    document.body.innerHTML = ''
    const nodes: Element[] = []
    const base = Object.getOwnPropertyDescriptor(Node.prototype, 'parentElement')!
    let visits = 0
    let parent: Element = document.body
    for (let i = 0; i < 200; i++) {
      const e = document.createElement('div')
      parent.appendChild(e)
      Object.defineProperty(e, 'parentElement', { configurable: true, get() { visits++; return base.get!.call(this) as Element | null } })
      nodes.push(e)
      parent = e
    }
    const out = topLevel(new Set(nodes))
    expect([...out]).toEqual([nodes[0]])
    expect(visits).toBeLessThanOrEqual(nodes.length + 8)
  })

  it('keeps siblings from separate branches and leaves small sets alone', () => {
    document.body.innerHTML = '<div id="a"><div id="b"></div></div><div id="c"></div>'
    const a = document.getElementById('a')!, b = document.getElementById('b')!, c = document.getElementById('c')!
    expect([...topLevel(new Set([a, b, c]))]).toEqual([a, c])
    const one = new Set([b])
    expect(topLevel(one)).toBe(one)
  })
})

describe('watchBlur', () => {
  const size = (el: Element, w: number, h: number) => { el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) }
  const el = (id: string) => document.getElementById(id)!
  const flush = async () => { await Promise.resolve(); vi.advanceTimersByTime(100) }
  let stop: (() => void) | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <article>
        <img id="avatar"><picture id="pic"><img id="photo"></picture>
        <video id="vid"></video>
        <div id="tile" style="background-image: url(a.jpg)"></div>
        <span id="text">hello</span>
        <div id="wrap"><img id="ghost"></div>
      </article>
      <img id="outside">`
    size(el('avatar'), 40, 40); size(el('pic'), 0, 0); size(el('photo'), 224, 280); size(el('vid'), 224, 280); size(el('tile'), 300, 200); size(el('outside'), 400, 400); size(el('wrap'), 224, 280); size(el('ghost'), 224, 280)
    el('ghost').style.pointerEvents = 'none'
  })
  afterEach(() => { stop?.(); stop = null; vi.useRealTimers() })
  const marked = () => [...document.querySelectorAll('[data-gd-blur]')].map((e) => e.id).sort()

  it('marks big media inside the container only, not the picture wrapper, avatars or outside media', () => {
    stop = watchBlur(window, hint).stop
    expect(marked()).toEqual(['ghost', 'photo', 'tile', 'vid'])
  })
  it('marks media added later and media that grows, unmarks one that shrinks', async () => {
    stop = watchBlur(window, hint).stop
    const added = document.createElement('img')
    added.id = 'added'
    size(added, 200, 200)
    document.querySelector('article')!.append(added)
    await flush()
    expect(marked()).toContain('added')
    size(el('avatar'), 120, 120)
    document.querySelector('article')!.append(document.createElement('i'))
    await flush()
    expect(marked()).toContain('avatar')
    size(el('avatar'), 30, 30)
    document.querySelector('article')!.append(document.createElement('i'))
    await flush()
    expect(marked()).not.toContain('avatar')
  })
  it('stop() removes every mark and hover', () => {
    const w = watchBlur(window, hint)
    w.stop()
    expect(marked()).toEqual([])
  })
  it('a pointer resting 300 ms over media reveals it (through overlays), leaving blurs again', () => {
    const overlay = document.createElement('div')
    document.body.append(overlay)
    stop = watchBlur(window, hint).stop
    let stack: Element[] = [overlay, el('photo'), el('pic')]
    document.elementsFromPoint = () => stack
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(299)
    expect(el('photo').hasAttribute('data-gd-hover')).toBe(false)
    vi.advanceTimersByTime(2)
    expect(el('photo').hasAttribute('data-gd-hover')).toBe(true)
    expect(el('vid').hasAttribute('data-gd-hover')).toBe(false)
    stack = [overlay]
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 900 }))
    expect(el('photo').hasAttribute('data-gd-hover')).toBe(false)
  })
  it('finds media with pointer-events none (Threads) through the box that holds it', () => {
    stop = watchBlur(window, hint).stop
    document.elementsFromPoint = () => [el('wrap')]
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(301)
    expect(el('ghost').hasAttribute('data-gd-hover')).toBe(true)
    expect(el('photo').hasAttribute('data-gd-hover')).toBe(false)
  })
  it('moving away before 300 ms never reveals, and clicks are not intercepted', () => {
    stop = watchBlur(window, hint).stop
    let stack: Element[] = [el('vid')]
    document.elementsFromPoint = () => stack
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(200)
    stack = []
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 900 }))
    vi.advanceTimersByTime(1000)
    expect(el('vid').hasAttribute('data-gd-hover')).toBe(false)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    el('photo').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})

describe('watchBlur items mode (WhatsApp privacy blur, D47)', () => {
  const wa = { container: '#app', items: ['#pane-side [role="listitem"]', '#main header', '#main [data-id]'], exclude: ['footer', '[contenteditable="true"]'] }
  const el = (id: string) => document.getElementById(id)!
  const size = (e: Element, w: number, h: number, top = 0) => { e.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top, right: w, bottom: top + h, x: 0, y: top, toJSON() {} }) }
  const marked = () => [...document.querySelectorAll('[data-gd-blur]')].map((e) => e.id).sort()
  let stop: (() => void) | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = `<div id="app">
      <div id="pane-side"><div role="listitem" id="r1"><span id="n1">Ann</span></div><div role="listitem" id="r2">Bob</div></div>
      <div id="main"><header id="hd">Ann</header><div data-id="m1" id="m1">hi</div><div data-id="m2" id="m2"><img id="im" width="1"></div>
        <footer id="ft"><div contenteditable="true" id="box" data-id="x">type</div></footer></div></div><span id="out" data-id="o">out</span>`
    for (const id of ['r1', 'r2', 'hd', 'm1', 'm2', 'ft', 'box', 'im']) size(el(id), 50, 20)
  })
  afterEach(() => { stop?.(); stop = null; vi.useRealTimers() })

  it('marks chat rows, header and every message regardless of size; never the compose box, footer or outside items', () => {
    stop = watchBlur(window, wa).stop
    expect(marked()).toEqual(['hd', 'm1', 'm2', 'r1', 'r2'])
  })
  it('keeps marks current for added items', async () => {
    stop = watchBlur(window, wa).stop
    const m = document.createElement('div'); m.id = 'm3'; m.setAttribute('data-id', '3'); size(m, 10, 10)
    el('main').append(m)
    await Promise.resolve(); vi.advanceTimersByTime(100)
    expect(marked()).toContain('m3')
  })
  it('hovering one item 300 ms reveals only that item; leaving re-blurs', () => {
    stop = watchBlur(window, wa).stop
    let stack: Element[] = [el('n1'), el('r1'), el('pane-side')]
    document.elementsFromPoint = () => stack
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(299)
    expect(el('r1').hasAttribute('data-gd-hover')).toBe(false)
    vi.advanceTimersByTime(2)
    expect(el('r1').hasAttribute('data-gd-hover')).toBe(true)
    expect(el('r2').hasAttribute('data-gd-hover')).toBe(false)
    stack = [el('app')]
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 900 }))
    expect(el('r1').hasAttribute('data-gd-hover')).toBe(false)
  })
  it('stop() removes every mark', () => {
    stop = watchBlur(window, wa).stop
    stop(); stop = null
    expect(marked()).toEqual([])
  })
})

describe('presets and the stored flag', () => {
  it('only x, threads, instagram, facebook and whatsapp have a hint; whatsapp is in items mode', () => {
    expect(PRESETS.filter((p) => p.blurMedia).map((p) => p.id).sort()).toEqual(['facebook', 'instagram', 'threads', 'whatsapp', 'x'])
    const wa = PRESETS.find((p) => p.id === 'whatsapp')!.blurMedia!
    expect(wa.container).toBe('#app')
    expect(wa.items).toBeUndefined()
    expect(wa.strength).toBe('light')
    expect(Object.keys(wa.parts!).sort()).toEqual(['avatars', 'messages', 'names', 'previews'])
    expect(wa.exclude).toEqual(expect.arrayContaining(['footer', '[contenteditable="true"]']))
  })
  it('setBlurMedia stores the flag per account, default off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-blur-'))
    const a = addAccount(dir, { serviceId: 'x', label: 'a', colour: '#6d5bd0' })
    const b = addAccount(dir, { serviceId: 'threads', label: 'b', colour: '#6d5bd0' })
    expect(loadAccounts(dir).every((x) => !x.blurMedia)).toBe(true)
    setBlurMedia(dir, a.id, true)
    expect(loadAccounts(dir).find((x) => x.id === a.id)?.blurMedia).toBe(true)
    expect(loadAccounts(dir).find((x) => x.id === b.id)?.blurMedia).toBeFalsy()
  })
})

describe('AccountSheet blur toggle', () => {
  const acc = (serviceId: string, blurMedia?: boolean) => ({ id: 'a1', serviceId, label: 'L', colour: '#6d5bd0', blurMedia })
  it('is shown only for services with a hint and emits the flipped value', async () => {
    for (const s of ['x', 'threads', 'instagram', 'facebook']) expect(mount(AccountSheet, { props: { account: acc(s) } }).find('[aria-label="Blur media until hovered"]').exists()).toBe(true)
    for (const s of ['discord', 'tiktok']) expect(mount(AccountSheet, { props: { account: acc(s) } }).find('[aria-label="Blur media until hovered"]').exists()).toBe(false)
    const w = mount(AccountSheet, { props: { account: acc('x') } })
    const t = w.find('[aria-label="Blur media until hovered"]')
    expect(t.attributes('aria-checked')).toBe('false')
    await t.trigger('click')
    expect(w.emitted('blur')![0]).toEqual([true])
    const wa = mount(AccountSheet, { props: { account: acc('whatsapp') } })
    expect(wa.find('[aria-label="Privacy blur"]').exists()).toBe(true)
    expect(wa.find('[aria-label="Blur media until hovered"]').exists()).toBe(false)
    expect(wa.text()).toContain('Privacy blur')
    await wa.find('[aria-label="Privacy blur"]').trigger('click')
    expect(wa.emitted('blur')![0]).toEqual([true])
    expect(mount(AccountSheet, { props: { account: acc('x', true) } }).find('[aria-label="Blur media until hovered"]').attributes('aria-checked')).toBe('true')
  })
})

describe('WhatsApp blur parts (D48)', () => {
  const hint = { container: '#app', parts: { messages: ['.m'], previews: ['.p'], avatars: ['img'], names: ['.n'] }, exclude: ['footer'], strength: 'light' as const }
  it('selectorsFor returns only the enabled parts', () => {
    expect(selectorsFor(hint, ['previews', 'names'])).toEqual(['.p', '.n'])
    expect(selectorsFor(hint, [])).toEqual([])
    expect(selectorsFor({ container: '#app', items: ['a'] }, [])).toEqual(['a'])
  })
  it('light strength is 5px, default stays 28px', () => {
    expect(blurCss('light')).toContain('filter: blur(5px)')
    expect(blurCss('light')).not.toContain('28px')
    expect(blurCss()).toContain('filter: blur(28px)')
  })
  it('light text dissolves with a text shadow (no box-shaped filter edge); media keeps the filter', () => {
    const css = blurCss('light')
    expect(css).toMatch(/\[data-gd-blur\]:not\(img\):not\(video\):not\(\[data-gd-hover\]\)[^{]*\{[^}]*-webkit-text-fill-color: transparent[^}]*text-shadow: 0 0 \d+px/)
    expect(css).toMatch(/img\[data-gd-blur\]:not\(\[data-gd-hover\]\)[^{]*\{[^}]*filter: blur\(5px\)/)
    expect(css).toMatch(/\[data-gd-blur\]:not\(\[data-gd-hover\]\) img[^{]*\{[^}]*filter: blur\(5px\)/)
    expect(css).not.toMatch(/\[data-gd-blur\]:not\(\[data-gd-hover\]\) \{ filter/)
    expect(css).toMatch(/img\[data-gd-blur\][^{]*\{[^}]*mask-image: linear-gradient/)
  })
  it('hint argument keeps parts and strength', () => {
    expect(parseBlurHint(['--gd-blur=' + JSON.stringify(hint)])).toEqual(hint)
  })
  it('partsOn: a missing flag is on', () => {
    expect(partsOn(undefined)).toEqual(['messages', 'previews', 'avatars', 'names'])
    expect(partsOn({ previews: false, names: true })).toEqual(['messages', 'avatars', 'names'])
  })
  it('real preset selectors pick the smallest element and leave times and the compose box sharp', () => {
    const wa = PRESETS.find((p) => p.id === 'whatsapp')!.blurMedia!
    document.body.innerHTML = `<div id="app">
      <div id="pane-side"><div role="listitem"><img id="av1"><div role="gridcell"><div><span dir="auto" title="Ann" id="nm1">Ann</span><span id="tm1">10:00</span></div><div><span dir="ltr" id="pv1">hello</span><span id="ic1"></span></div></div></div></div>
      <div id="main"><header><img id="av2"><span dir="auto" title="Ann" id="nm2">Ann</span></header>
        <div data-id="m1"><div class="copyable-text" id="tx"><span class="selectable-text">hi</span></div><span id="tm2">10:01</span></div>
        <div data-id="m2"><img id="pic"></div>
        <footer><div contenteditable="true" id="box"><span class="selectable-text" id="bx">type</span></div></footer></div></div>`
    const sel = (id: string) => document.getElementById(id)!
    const marked = () => [...document.querySelectorAll('[data-gd-blur]')].map((e) => e.id).filter(Boolean).sort()
    const w = watchBlur(window, wa, partsOn(undefined))
    expect(marked()).toEqual(['av1', 'av2', 'nm1', 'nm2', 'pic', 'pv1', 'tx'])
    expect(sel('tm1').hasAttribute('data-gd-blur') || sel('tm2').hasAttribute('data-gd-blur') || sel('bx').hasAttribute('data-gd-blur')).toBe(false)
    w.setParts(['previews'])
    expect(marked()).toEqual(['pv1'])
    w.setParts([])
    expect(marked()).toEqual([])
    w.stop()
  })
  it('setBlurPart stores one flag per account without touching the others', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-blurp-'))
    const a = addAccount(dir, { serviceId: 'whatsapp', label: 'a', colour: '#6d5bd0' })
    setBlurMedia(dir, a.id, true)
    expect(loadAccounts(dir)[0].blurParts).toBeUndefined()
    setBlurPart(dir, a.id, 'previews', false)
    expect(loadAccounts(dir)[0].blurParts).toEqual({ previews: false })
    expect(partsOn(loadAccounts(dir)[0].blurParts)).toEqual(['messages', 'avatars', 'names'])
  })
  it('AccountSheet shows four sub-switches for WhatsApp only, enabled only when blur is on, and emits the flip', async () => {
    const acc = (serviceId: string, blurMedia?: boolean, blurParts?: Record<string, boolean>) => ({ id: 'a1', serviceId, label: 'L', colour: '#6d5bd0', blurMedia, blurParts })
    expect(mount(AccountSheet, { props: { account: acc('x', true) } }).findAll('[data-part]').length).toBe(0)
    const off = mount(AccountSheet, { props: { account: acc('whatsapp', false) } })
    expect(off.findAll('[data-part]').length).toBe(4)
    expect(off.findAll('[data-part]').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    const on = mount(AccountSheet, { props: { account: acc('whatsapp', true, { previews: false }) } })
    expect(on.find('[aria-label="Chat list previews"]').attributes('aria-checked')).toBe('false')
    expect(on.find('[aria-label="Names"]').attributes('aria-checked')).toBe('true')
    await on.find('[aria-label="Profile photos"]').trigger('click')
    expect(on.emitted('blurPart')![0]).toEqual(['avatars', false])
    await on.find('[aria-label="Chat list previews"]').trigger('click')
    expect(on.emitted('blurPart')![1]).toEqual(['previews', true])
  })
})
