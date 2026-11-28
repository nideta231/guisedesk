import { describe, expect, it, vi } from 'vitest'
import { trayChange, trayLook, trayTemplate } from '../src/main/traymenu'

describe('trayTemplate', () => {
  it('has a Do Not Disturb checkbox that reflects the state and reports the new one', () => {
    const onDnd = vi.fn()
    const t = trayTemplate({ dnd: true, onLock: () => {}, onShow: () => {}, onSettings: () => {}, onDnd, onQuit: () => {} })
    const item = t.find((i) => i.label === 'Do Not Disturb')!
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(true)
    ;(item.click as (m: { checked: boolean }) => void)({ checked: false })
    expect(onDnd).toHaveBeenCalledWith(false)
    expect(trayTemplate({ dnd: false, onLock: () => {}, onShow: () => {}, onSettings: () => {}, onDnd, onQuit: () => {} }).find((i) => i.label === 'Do Not Disturb')!.checked).toBe(false)
  })

  it('menu order is Show, Lock now (Ctrl+L), Do Not Disturb, Settings, Quit; Lock now calls onLock', () => {
    const onLock = vi.fn()
    const t = trayTemplate({ dnd: false, onLock, onShow: () => {}, onSettings: () => {}, onDnd: () => {}, onQuit: () => {} })
    expect(t.filter((i) => i.label).map((i) => i.label)).toEqual(['Show GuiseDesk', 'Lock now', 'Do Not Disturb', 'Settings', 'Quit'])
    const item = t.find((i) => i.label === 'Lock now')!
    expect(item.accelerator).toBe('Ctrl+L')
    item.click!({ checked: false })
    expect(onLock).toHaveBeenCalledTimes(1)
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
    trayTemplate({ dnd: false, onLock: () => {}, onShow, onSettings, onDnd: () => {}, onQuit: () => {} }).find((i) => i.label === 'Settings')!.click!({ checked: false })
    expect(onSettings).toHaveBeenCalledOnce()
    expect(onShow).not.toHaveBeenCalled()
  })
})
