import { describe, expect, it } from 'vitest'
import { applyPermissionPolicy, permissionAllowed } from '../src/main/permissions'

describe('permissionAllowed', () => {
  it('grants notifications', () => {
    expect(permissionAllowed('notifications')).toBe(true)
  })
  it('grants clipboard writes so site Copy buttons work, but not reads', () => {
    expect(permissionAllowed('clipboard-sanitized-write')).toBe(true)
    expect(permissionAllowed('clipboard-read')).toBe(false)
  })
  it('denies camera, mic and geolocation by default', () => {
    for (const p of ['media', 'camera', 'microphone', 'geolocation', 'midi', 'clipboard-read'])
      expect(permissionAllowed(p)).toBe(false)
  })
})

describe('applyPermissionPolicy', () => {
  it('records both handlers on the session and answers with the same policy', () => {
    let request: ((wc: unknown, permission: string, cb: (ok: boolean) => void) => void) | undefined
    let check: ((wc: unknown, permission: string) => boolean) | undefined
    applyPermissionPolicy({
      setPermissionRequestHandler: (h) => void (request = h),
      setPermissionCheckHandler: (h) => void (check = h)
    })
    expect(request).toBeTypeOf('function')
    expect(check).toBeTypeOf('function')

    const asked: [string, boolean][] = []
    for (const p of ['notifications', 'clipboard-sanitized-write', 'camera', 'microphone', 'geolocation'])
      request!({}, p, (ok) => asked.push([p, ok]))
    expect(asked).toEqual([
      ['notifications', true],
      ['clipboard-sanitized-write', true],
      ['camera', false],
      ['microphone', false],
      ['geolocation', false]
    ])
    expect(check!({}, 'notifications')).toBe(true)
    expect(check!({}, 'camera')).toBe(false)
  })
})
