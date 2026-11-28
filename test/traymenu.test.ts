import { describe, expect, it, vi } from 'vitest'
import { bulkTargets, trayChange, trayLook, trayTemplate, trayUnreadItems, type TrayActions } from '../src/main/traymenu'

const opts = (over: Partial<TrayActions> = {}): TrayActions => ({
  dnd: false,
  onLock: () => {},
  onShow: () => {},
  onSettings: () => {},
  onDnd: () => {},
  onReloadAll: () => {},
  onSleepAll: () => {},
  onQuit: () => {},
  ...over
})

describe('trayTemplate', () => {
  it('has a Do Not Disturb checkbox that reflects the state and reports the new one', () => {
    const onDnd = vi.fn()
    const t = trayTemplate(opts({ dnd: true, onDnd }))
    const item = t.find((i) => i.label === 'Do Not Disturb')!
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(true)
    ;(item.click as (m: { checked: boolean }) => void)({ checked: false })
    expect(onDnd).toHaveBeenCalledWith(false)
    expect(trayTemplate(opts({ dnd: false })).find((i) => i.label === 'Do Not Disturb')!.checked).toBe(false)
  })

  it('menu order is Show, Lock now (Ctrl+L), Do Not Disturb, Reload all, Sleep all, Settings, Quit; Lock now calls onLock', () => {
    const onLock = vi.fn()
    const t = trayTemplate(opts({ onLock }))
    expect(t.filter((i) => i.label).map((i) => i.label)).toEqual([
      'Show GuiseDesk', 'Lock now', 'Do Not Disturb', 'Reload all accounts', 'Sleep all accounts', 'Settings', 'Quit'
    ])
    const item = t.find((i) => i.label === 'Lock now')!
    expect(item.accelerator).toBe('Ctrl+L')
    item.click!({ checked: false })
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('the bulk rows call their callbacks (UX-033)', () => {
    const onReloadAll = vi.fn()
    const onSleepAll = vi.fn()
    const t = trayTemplate(opts({ onReloadAll, onSleepAll }))
    t.find((i) => i.label === 'Reload all accounts')!.click!({ checked: false })
    t.find((i) => i.label === 'Sleep all accounts')!.click!({ checked: false })
    expect(onReloadAll).toHaveBeenCalledOnce()
    expect(onSleepAll).toHaveBeenCalledOnce()
  })
})

describe('bulkTargets (UX-033)', () => {
  const rows = [
    { id: 'a', enabled: true },
    { id: 'b', enabled: true },
    { id: 'c', enabled: false }
  ]

  it('sleep leaves out the selected account and every disabled one', () => {
    expect(bulkTargets(rows, 'a', 'sleep').map((a) => a.id)).toEqual(['b'])
    expect(bulkTargets(rows, 'missing', 'sleep').map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('reload includes every enabled account, even the selected one', () => {
    expect(bulkTargets(rows, 'a', 'reload').map((a) => a.id)).toEqual(['a', 'b'])
  })
})

describe('trayUnreadItems (UX-034)', () => {
  const accounts = [
    { id: 'a', label: 'Personal', serviceId: 'whatsapp', order: 0 },
    { id: 'b', label: 'Work', serviceId: 'discord', order: 1 },
    { id: 'c', label: '@ben', serviceId: 'x', order: 2 },
    { id: 'd', label: 'Off', serviceId: 'instagram', order: 3, enabled: false }
  ]

  it('lists the accounts with a count in sidebar order, leaving out zero and disabled ones', () => {
    expect(trayUnreadItems({ a: 2, b: 0, c: 5, d: 9 }, accounts)).toEqual([
      { id: 'a', label: 'Personal', count: 2 },
      { id: 'c', label: '@ben', count: 5 }
    ])
    expect(trayUnreadItems({ a: 0, b: 0, c: 0 }, accounts)).toEqual([])
  })

  it('builds an Unread submenu whose rows carry the account id', () => {
    const onUnread = vi.fn()
    const items = trayUnreadItems({ a: 2, c: 5 }, accounts)
    const t = trayTemplate(opts({ unread: items, onUnread }))
    const menu = t.find((i) => i.label === 'Unread (7)')!
    expect(menu.submenu!.map((s) => s.label)).toEqual(['Personal (2)', '@ben (5)'])
    menu.submenu![1].click!({ checked: false })
    expect(onUnread).toHaveBeenCalledWith('c')
    expect(trayTemplate(opts({ unread: [] })).find((i) => i.label?.startsWith('Unread'))).toBeUndefined()
  })
})

describe('trayLook', () => {
  it('shows the red dot and count when unlocked and unread; plain icon while locked', () => {
    expect(trayLook(3, false)).toEqual({ icon: 'tray-dot.png', tooltip: 'GuiseDesk (3 unread)' })
    expect(trayLook(0, false)).toEqual({ icon: 'tray.png', tooltip: 'GuiseDesk' })
    expect(trayLook(3, true)).toEqual({ icon: 'tray.png', tooltip: 'GuiseDesk' })
  })
})

describe('trayChange', () => {
  it('asks for a new image only when the dot state changes', () => {
    expect(trayChange({ total: 3, locked: false }, { total: 4, locked: false })).toBe('same')
    expect(trayChange({ total: 0, locked: false }, { total: 1, locked: false })).toBe('dot')
    expect(trayChange({ total: 1, locked: false }, { total: 0, locked: false })).toBe('plain')
    expect(trayChange({ total: 3, locked: false }, { total: 3, locked: true })).toBe('plain')
    expect(trayChange({ total: 0, locked: true }, { total: 0, locked: false })).toBe('same')
  })
})

describe('tray Settings item', () => {
  it('calls onSettings, not onShow', () => {
    const onSettings = vi.fn()
    const onShow = vi.fn()
    trayTemplate(opts({ onSettings, onShow })).find((i) => i.label === 'Settings')!.click!({ checked: false })
    expect(onSettings).toHaveBeenCalledOnce()
    expect(onShow).not.toHaveBeenCalled()
  })
})
