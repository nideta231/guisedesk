// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { addDownload, clearDownloads, DOWNLOAD_HISTORY_MAX, type DownloadEntry } from '../src/main/downloads'
import SettingsGeneral from '../src/renderer/src/SettingsGeneral.vue'

const entry = (name: string, time: number): DownloadEntry => ({ path: `/dl/${name}`, name, time, ok: true })

describe('recent downloads list (UX-009)', () => {
  it('puts the newest first and keeps only the 20 newest', () => {
    const full = Array.from({ length: DOWNLOAD_HISTORY_MAX }, (_, i) => entry(`old-${i}.txt`, i))
    const next = addDownload(full, entry('newest.txt', 99))
    expect(next).toHaveLength(DOWNLOAD_HISTORY_MAX)
    expect(next[0].name).toBe('newest.txt')
    expect(next.some((d) => d.name === 'old-19.txt')).toBe(false)
  })

  it('ignores a cancelled download and does not mutate the input', () => {
    const list = [entry('a.txt', 1)]
    const next = addDownload(list, { ...entry('cancelled.txt', 2), cancelled: true })
    expect(next).toBe(list)
    expect(next.map((d) => d.name)).toEqual(['a.txt'])
  })

  it('clears the list', () => {
    expect(clearDownloads()).toEqual([])
  })
})

describe('Settings > General Recent downloads card', () => {
  const rows: DownloadEntry[] = [
    { path: '/dl/report.pdf', name: 'report.pdf', time: 1000, ok: true },
    { path: '/dl/broken.zip', name: 'broken.zip', time: 500, ok: false }
  ]

  function makeBridge() {
    return {
      prefs: async () => ({ idleLock: 10, dnd: false, startOnLogin: false }),
      downloads: async () => ({ dir: '/dl', ask: false }),
      downloadsList: vi.fn(async () => rows),
      showDownload: vi.fn(async () => true),
      clearDownloads: vi.fn(async () => []),
      blocking: async () => ({ ads: false, popups: true })
    }
  }

  it('renders the finished files and shows one in its folder when its row is clicked', async () => {
    const bridge = makeBridge()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const card = w.findAll('.card').find((c) => c.find('h4').text() === 'Recent downloads')!
    expect(card.exists()).toBe(true)
    expect(card.findAll('.dlr').map((r) => r.text())).toEqual([
      'report.pdfSaved · ' + new Date(1000).toLocaleString() + 'Show in folder',
      'broken.zipFailed · ' + new Date(500).toLocaleString() + 'Show in folder'
    ])
    await card.findAll('.dlr')[0].trigger('click')
    expect(bridge.showDownload).toHaveBeenCalledWith('/dl/report.pdf')
  })

  it('clears the list with the Clear list action', async () => {
    const bridge = makeBridge()
    ;(window as unknown as { guisedesk: unknown }).guisedesk = bridge
    const w = mount(SettingsGeneral, { props: { update: { state: 'none' } } })
    await flushPromises()
    const card = w.findAll('.card').find((c) => c.find('h4').text() === 'Recent downloads')!
    const clear = card.findAll('button.lnk').find((b) => b.text() === 'Clear list')!
    await clear.trigger('click')
    await flushPromises()
    expect(bridge.clearDownloads).toHaveBeenCalledOnce()
    expect(card.findAll('.dlr')).toHaveLength(0)
  })
})
