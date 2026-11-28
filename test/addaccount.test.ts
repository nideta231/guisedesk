// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddAccount from '../src/renderer/src/AddAccount.vue'
import App from '../src/renderer/src/App.vue'

const pick = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('.pk').find((p) => p.text() === name)!

describe('AddAccount dialog', () => {
  it('shows the seven services and Custom URL with service logos, and the kind hint', async () => {
    const w = mount(AddAccount)
    expect(w.findAll('.pk').map((p) => p.text())).toEqual([
      'WhatsApp', 'Instagram', 'Facebook', 'X', 'Threads', 'TikTok', 'Discord', 'Custom URL'
    ])
    expect(w.findAll('.pk .lg svg')).toHaveLength(8)
    expect(w.find('.pk.sel').text()).toBe('WhatsApp')
    expect(w.find('.hint').text()).toBe('WhatsApp is a chat: it stays on so notifications arrive. You can change that later.')
    await pick(w, 'TikTok').trigger('click')
    expect(w.find('.hint').text()).toContain('TikTok is a feed: it sleeps after 30 minutes')
  })

  it('emits add with the trimmed label, service and colour', async () => {
    const w = mount(AddAccount)
    await pick(w, 'Instagram').trigger('click')
    await w.find('input.label').setValue('  Shop  ')
    await w.findAll('.sw button')[2].trigger('click')
    await w.find('.btn.pri').trigger('click')
    const [payload] = w.emitted('add')![0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ serviceId: 'instagram', label: 'Shop' })
    expect(payload.colour).toMatch(/^#[0-9a-f]{6}$/)
    expect(payload.custom).toBeUndefined()
  })

  it('refuses an empty label and a non-http URL for Custom URL', async () => {
    const w = mount(AddAccount)
    await w.find('.btn.pri').trigger('click')
    expect(w.emitted('add')).toBeUndefined()
    expect(w.find('.err').text()).toBe('Label is required')
    await pick(w, 'Custom URL').trigger('click')
    await w.find('input.label').setValue('Wiki')
    await w.find('input.cname').setValue('Wiki')
    await w.find('input.curl').setValue('ftp://x.example.com')
    await w.find('.btn.pri').trigger('click')
    expect(w.emitted('add')).toBeUndefined()
    expect(w.find('.err').text()).toBe('URL must start with http:// or https://')
    await w.find('input.curl').setValue('https://x.example.com/')
    await w.find('.btn.pri').trigger('click')
    expect(w.emitted('add')![0][0]).toMatchObject({
      serviceId: 'custom', label: 'Wiki', custom: { name: 'Wiki', url: 'https://x.example.com/' }
    })
  })

  it('service tiles and colour swatches are buttons with role=radio and work from the keyboard', async () => {
    const w = mount(AddAccount)
    const tiles = w.findAll('.pick [role="radio"]')
    expect(tiles).toHaveLength(8)
    expect(tiles.every((t) => t.element.tagName === 'BUTTON')).toBe(true)
    expect(tiles.every((t) => t.attributes('tabindex') === undefined)).toBe(true)
    expect(w.find('.pick').attributes('role')).toBe('radiogroup')
    expect(w.find('.pick').attributes('aria-label')).toBe('Service')
    const tiktok = pick(w, 'TikTok')
    expect(tiktok.attributes('aria-checked')).toBe('false')
    await tiktok.trigger('keydown', { key: 'Enter' })
    expect(tiktok.attributes('aria-checked')).toBe('true')
    const sw = w.findAll('.sw [role="radio"]')
    expect(sw).toHaveLength(6)
    expect(sw.every((s) => s.element.tagName === 'BUTTON')).toBe(true)
    expect(sw[0].attributes('aria-checked')).toBe('true')
    expect(sw[2].attributes('aria-label')).toBe('Colour 3')
    await sw[2].trigger('keydown', { key: 'Enter' })
    expect(sw[2].attributes('aria-checked')).toBe('true')
  })

  it('Cancel emits cancel and no add', async () => {
    const w = mount(AddAccount)
    await w.findAll('.btn').find((b) => b.text() === 'Cancel')!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('add')).toBeUndefined()
  })
})

describe('App add flow', () => {
  const acc = (id: string, label: string, order: number) => ({ id, serviceId: 'whatsapp', label, colour: '#6d5bd0', order })
  let bridge: { lockState: unknown; onLock: unknown; state: ReturnType<typeof vi.fn>; sleep: unknown; onSleep: unknown; onSidebar: unknown; onZoom: unknown; onLinkChoose: unknown; onRowMenuPick: unknown; onUpdate: unknown; updateState: unknown; select: ReturnType<typeof vi.fn>; dialog: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; unread: ReturnType<typeof vi.fn>; onUnread: ReturnType<typeof vi.fn>; onSelected: ReturnType<typeof vi.fn>; onOpenSettings: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    bridge = {
      lockState: async () => ({ state: 'unlocked' }),
      onLock: vi.fn(),
      state: vi.fn(async () => ({ accounts: [acc('a1', 'Personal', 0)], selectedId: 'a1', disabledServices: [] })),
      unread: vi.fn(async () => ({})),
      onUnread: vi.fn(),
      onSelected: vi.fn(),
      onOpenSettings: vi.fn(),
      sleep: async () => ({}),
      onSleep: vi.fn(),
      onSidebar: vi.fn(),
      onZoom: vi.fn(),
      onLinkChoose: vi.fn(),
      onRowMenuPick: () => {},
      onUpdate: () => {},
      updateState: async () => ({ state: 'none' }),
      select: vi.fn(),
      dialog: vi.fn(),
      add: vi.fn(async () => ({
        accounts: [acc('a1', 'Personal', 0), acc('a2', 'Business', 1)], selectedId: 'a2', disabledServices: []
      }))
    }
    ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
  })

  it('+ opens the dialog; Add & open adds, selects the new account and closes it', async () => {
    const w = mount(App)
    await flushPromises()
    expect(w.find('.glass').exists()).toBe(false)
    await w.find('.brand .add').trigger('click')
    expect(w.find('.glass').exists()).toBe(true)
    expect(bridge.dialog).toHaveBeenLastCalledWith(true)
    await w.find('input.label').setValue('Business')
    await w.find('.btn.pri').trigger('click')
    await flushPromises()
    expect(bridge.add).toHaveBeenCalledOnce()
    expect(bridge.add.mock.calls[0][0]).toMatchObject({ serviceId: 'whatsapp', label: 'Business' })
    expect(w.find('.glass').exists()).toBe(false)
    expect(bridge.dialog).toHaveBeenLastCalledWith(false)
    const on = w.find('.row.on')
    expect(on.find('.name').text()).toContain('Business')
  })

  it('Cancel closes the dialog and adds nothing', async () => {
    const w = mount(App)
    await flushPromises()
    await w.find('.brand .add').trigger('click')
    await w.findAll('.btn').find((b) => b.text() === 'Cancel')!.trigger('click')
    expect(w.find('.glass').exists()).toBe(false)
    expect(bridge.add).not.toHaveBeenCalled()
    expect(bridge.dialog).toHaveBeenLastCalledWith(false)
    expect(w.findAll('.row')).toHaveLength(1)
  })
})
