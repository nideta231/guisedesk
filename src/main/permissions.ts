// Permission policy for service pages: notifications and clipboard writes (site "Copy link" buttons use
// navigator.clipboard.writeText) are granted; clipboard reads, camera, mic, geolocation and the rest are denied.
const ALLOWED = new Set(['notifications', 'clipboard-sanitized-write'])

export function permissionAllowed(permission: string): boolean {
  return ALLOWED.has(permission)
}

/** The parts of an Electron session the permission policy needs (kept structural so vitest needs no electron). */
export interface PermissionSession {
  setPermissionRequestHandler(handler: (wc: unknown, permission: string, callback: (allowed: boolean) => void) => void): void
  setPermissionCheckHandler(handler: (wc: unknown, permission: string) => boolean): void
}

/** Installs both permission handlers, so a service view and a popup on the same partition share one policy. */
export function applyPermissionPolicy(ses: PermissionSession): void {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permissionAllowed(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission))
}
