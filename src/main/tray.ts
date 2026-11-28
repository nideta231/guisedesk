// Tray glue (D4): plain and red-dot icon, menu from traymenu.ts.
import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { trayChange, trayLook, trayTemplate, trayUnreadSig, type TrayIcon, type TrayUnreadItem } from './traymenu'

const icon = (name: string) => nativeImage.createFromPath(join(__dirname, '../../resources', name))

export function createTray(onShow: () => void, onLock: () => void, onSettings: () => void, dnd: boolean, onDnd: (on: boolean) => void, onReloadAll: () => void, onSleepAll: () => void, onSelectAccount: (id: string) => void): { setUnread(total: number, locked: boolean, unread: TrayUnreadItem[]): void; setDnd(on: boolean): void } {
  const images: Record<TrayIcon, Electron.NativeImage> = { plain: icon('tray.png'), dot: icon('tray-dot.png') }
  const tray = new Tray(images.plain)
  tray.setToolTip('GuiseDesk')
  let unread: TrayUnreadItem[] = []
  let unreadSig = ''
  let currentDnd = dnd
  let locked = false
  const menu = (on: boolean) => {
    currentDnd = on
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate({ dnd: on, locked, unread, onUnread: onSelectAccount, onLock, onShow, onSettings, onDnd, onReloadAll, onSleepAll, onQuit: () => app.quit() })))
  }
  menu(dnd)
  tray.on('click', onShow)
  let total = 0
  return {
    // Settings changed Do Not Disturb: rebuild the menu so the checkbox follows.
    setDnd: menu,
    setUnread(nextTotal, nextLocked, nextUnread) {
      const change = trayChange({ total, locked }, { total: nextTotal, locked: nextLocked })
      if (change !== 'same') tray.setImage(images[change])
      tray.setToolTip(trayLook(nextTotal, nextLocked).tooltip)
      total = nextTotal
      locked = nextLocked
      // The Unread submenu is rebuilt when an id/count changes or the lock flips, not on every title update (UX-034).
      const sig = trayUnreadSig(nextUnread, nextLocked)
      if (sig !== unreadSig) {
        unread = nextUnread
        unreadSig = sig
        menu(currentDnd)
      }
    }
  }
}
