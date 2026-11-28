// Tray glue (D4): plain and red-dot icon, menu from traymenu.ts.
import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { trayChange, trayLook, trayTemplate, type TrayIcon } from './traymenu'

const icon = (name: string) => nativeImage.createFromPath(join(__dirname, '../../resources', name))

export function createTray(onShow: () => void, onLock: () => void, onSettings: () => void, dnd: boolean, onDnd: (on: boolean) => void): { setUnread(total: number, locked: boolean): void; setDnd(on: boolean): void } {
  const images: Record<TrayIcon, Electron.NativeImage> = { plain: icon('tray.png'), dot: icon('tray-dot.png') }
  const tray = new Tray(images.plain)
  tray.setToolTip('GuiseDesk')
  const menu = (on: boolean) => tray.setContextMenu(Menu.buildFromTemplate(trayTemplate({ dnd: on, onLock, onShow, onSettings, onDnd, onQuit: () => app.quit() })))
  menu(dnd)
  tray.on('click', onShow)
  let total = 0
  let locked = false
  return {
    // Settings changed Do Not Disturb: rebuild the menu so the checkbox follows.
    setDnd: menu,
    setUnread(nextTotal, nextLocked) {
      const change = trayChange({ total, locked }, { total: nextTotal, locked: nextLocked })
      if (change !== 'same') tray.setImage(images[change])
      tray.setToolTip(trayLook(nextTotal, nextLocked).tooltip)
      total = nextTotal
      locked = nextLocked
    }
  }
}
