// Unread counts from page titles. No electron import.
import type { Preset } from './presets'

/** Count shown for a title: "(3) X" -> 3, "(99+) X" -> 100 (more than 99), Discord "• X" -> 1, else 0. */
export function parseUnread(title: string, preset: Preset | undefined): number {
  const m = /^\((\d+)(\+?)\)/.exec(title) ?? /^(\d+)()\s+unread\b/i.exec(title)
  if (m) {
    const n = Number(m[1])
    return m[2] && n <= 99 ? 100 : n
  }
  return preset?.id === 'discord' && title.startsWith('•') ? 1 : 0
}

export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

export function totalUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0)
}

/** The same counts without one account, for a logout that must stop advertising its old badge. */
export function without(counts: Record<string, number>, id: string): Record<string, number> {
  const out = { ...counts }
  delete out[id]
  return out
}
