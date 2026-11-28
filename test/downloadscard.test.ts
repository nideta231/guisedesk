// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'

describe('Settings > General Downloads card', () => {
  it('shows the folder and the switch; Change... picks a folder; the switch sends ask', async () => {
    const bridge = {
      prefs: async () => ({ idleLock: 10, dnd: false, startOnLogin: false }),
      downloads: vi.fn(async () => ({ dir: '/home/x/Downloads', ask: false })),
      setDownloadsAsk: vi.fn(async () => true),
      pickDownloadsDir: vi.fn(async () => '/data/files'),
      downloadsList: async () => []
    }
    ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const titles = w.findAll('.card h4').map((h) => h.text())
    expect(titles).toEqual(['Startup', 'Downloads', 'Recent downloads', 'Blocking', 'Keyboard', 'About and data', 'Backup', 'Updates', 'Quit'])
    const card = w.findAll('.card')[1]
    expect(card.find('.path').text()).toBe('/home/x/Downloads')
    const sw = card.find('.tg')
    expect(sw.classes()).not.toContain('on')
    await sw.trigger('click')
    await flushPromises()
    expect(bridge.setDownloadsAsk).toHaveBeenCalledWith(true)
    expect(sw.classes()).toContain('on')
    await card.find('.btn').trigger('click')
    await flushPromises()
    expect(card.find('.btn').text()).toBe('Change...')
    expect(bridge.pickDownloadsDir).toHaveBeenCalled()
    expect(card.find('.path').text()).toBe('/data/files')
  })
})
