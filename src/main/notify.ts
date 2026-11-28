// Notification decision (D4, D16, D19, D58). Plain TS: no electron import.
import { inWorkHours, type LockSchedule } from './schedule'

export interface NotifyEvent {
  accountId: string
  serviceName: string
  label: string
  title: string
  body?: string
  icon?: string
}

/** Flags later tickets fill in (mute D19, DND D19, hibernated account, lock D16). All off = normal. */
export interface NotifyState {
  muted?: boolean
  dnd?: boolean
  /** Quiet outside work hours (D58): dropped like DND, but the tray DND switch stays off. */
  quiet?: boolean
  asleep?: boolean
  locked?: boolean
  /** The account's service is switched off in Settings (D6). */
  disabled?: boolean
}

/** True when the user asked for quiet and this local time is outside the lock schedule's work days/hours (D58). */
export function quietOutsideWorkHours(enabled: boolean, schedule: LockSchedule, d: Date): boolean {
  return enabled && !inWorkHours(schedule, d)
}

export type NotifyDecision =
  | { action: 'drop' }
  | { action: 'generic'; accountId: string; title: string; body: string; subtitle: string }
  | { action: 'full'; accountId: string; title: string; body: string; subtitle: string; icon?: string }

export function decideNotification(event: NotifyEvent, state: NotifyState): NotifyDecision {
  if (state.muted || state.dnd || state.quiet || state.asleep || state.disabled) return { action: 'drop' }
  if (state.locked)
    return { action: 'generic', accountId: event.accountId, title: 'GuiseDesk', body: 'New message', subtitle: '' }
  return {
    action: 'full',
    accountId: event.accountId,
    title: event.title,
    body: event.body ?? '',
    subtitle: `${event.serviceName} - ${event.label}`,
    icon: event.icon
  }
}

/** A native notification click selects the account, or opens Settings > Services when its service is off (UX-042). */
export function notificationClickTarget(serviceDisabled: boolean): 'select' | 'services' {
  return serviceDisabled ? 'services' : 'select'
}
