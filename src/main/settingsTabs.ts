// Settings tabs (UX-006): shared by main's settings.json saver and the renderer's tab list. Plain TS, no electron.
export const SETTINGS_TABS = ['Services', 'Lock', 'Notifications', 'Extensions', 'General'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v)
}
