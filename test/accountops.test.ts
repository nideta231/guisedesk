import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadAccounts, loadDisabled, setIdlePolicy, setMuted, setServiceEnabled } from '../src/main/accounts'
import { logOut, removeAccount } from '../src/main/accountops'
import { createHibernator, limitMinutes } from '../src/main/hibernate'
import { decideNotification } from '../src/main/notify'

const acc = (id: string, serviceId: string, order: number) => ({ id, serviceId, label: id, colour: '#6d5bd0', order })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gd-ops-'))
  const dir = join(root, 'data')
  mkdirSync(join(dir, 'Partitions', 'ig1'), { recursive: true })
  mkdirSync(join(dir, 'Partitions', 'ig2'), { recursive: true })
  writeFileSync(join(dir, 'Partitions', 'ig1', 'Cookies'), 'x')
  writeFileSync(join(dir, 'Partitions', 'ig2', 'Cookies'), 'y')
  writeFileSync(join(root, 'keep.txt'), 'mine')
  writeFileSync(join(dir, 'accounts.json'), JSON.stringify([acc('ig1', 'instagram', 0), acc('ig2', 'instagram', 1), acc('wa1', 'whatsapp', 2)]))
  return { root, dir }
}

describe('service on/off', () => {
  it('turning a service off is saved in settings and leaves every account in the store', () => {
    const { dir } = fixture()
    const before = readFileSync(join(dir, 'accounts.json'), 'utf8')
    expect(setServiceEnabled(dir, 'instagram', false)).toEqual(['instagram'])
    expect(loadDisabled(dir)).toEqual(['instagram'])
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).toBe(before)
    expect(loadAccounts(dir)).toHaveLength(3)
    expect(existsSync(join(dir, 'Partitions', 'ig1', 'Cookies'))).toBe(true)
    expect(setServiceEnabled(dir, 'instagram', true)).toEqual([])
  })

  it('a disabled service raises no notification', () => {
    const ev = { accountId: 'ig1', serviceName: 'Instagram', label: 'Shop', title: 'Hi' }
    expect(decideNotification(ev, { disabled: true })).toEqual({ action: 'drop' })
  })
})

describe('sheet changes', () => {
  it('the sleep choice is saved and changes what hibernation does', () => {
    const { dir } = fixture()
    expect(limitMinutes(loadAccounts(dir)[0])).toBe(30)
    setIdlePolicy(dir, 'ig1', '10')
    const saved = loadAccounts(dir)
    expect(saved[0].idlePolicy).toBe('10')
    expect(saved[1].idlePolicy).toBeUndefined()
    let t = 0
    const hib = createHibernator(() => t)
    hib.sweep(saved)
    t = 11 * 60_000
    expect(hib.sweep(saved)).toEqual(['ig1'])
    setIdlePolicy(dir, 'wa1', '60')
    expect(limitMinutes(loadAccounts(dir)[2])).toBe(60)
    setIdlePolicy(dir, 'ig2', 'always')
    expect(limitMinutes(loadAccounts(dir)[1])).toBeNull()
  })

  it('refuses a policy outside default, always, 10, 30, 60', () => {
    const { dir } = fixture()
    expect(() => setIdlePolicy(dir, 'ig1', '5')).toThrow()
    expect(loadAccounts(dir)[0].idlePolicy).toBeUndefined()
  })

  it('mute is saved and silences notifications', () => {
    const { dir } = fixture()
    const a = setMuted(dir, 'ig1', true)[0]
    expect(decideNotification({ accountId: 'ig1', serviceName: 'x', label: 'x', title: 't' }, { muted: a.muted })).toEqual({ action: 'drop' })
  })
})

describe('log out and remove', () => {
  const deps = () => ({ clearStorage: vi.fn(async () => {}), closeView: vi.fn(), reloadView: vi.fn() })

  it('Log out clears that account storage and reloads its view, and keeps the account and its partition dir', async () => {
    const { dir } = fixture()
    const d = deps()
    expect(await logOut(dir, 'ig1', d)).toBe(true)
    expect(d.clearStorage).toHaveBeenCalledWith('ig1')
    expect(d.reloadView).toHaveBeenCalledWith('ig1')
    expect(loadAccounts(dir).map((a) => a.id)).toEqual(['ig1', 'ig2', 'wa1'])
    expect(existsSync(join(dir, 'Partitions', 'ig1'))).toBe(true)
  })

  it('Log out of an unknown id does nothing', async () => {
    const { dir } = fixture()
    const d = deps()
    expect(await logOut(dir, 'nope', d)).toBe(false)
    expect(d.clearStorage).not.toHaveBeenCalled()
  })

  it('Remove deletes the account and only its partition dir', async () => {
    const { dir, root } = fixture()
    const d = deps()
    expect(await removeAccount(dir, 'ig1', d)).toBe(true)
    expect(d.closeView).toHaveBeenCalledWith('ig1')
    expect(d.clearStorage).toHaveBeenCalledWith('ig1')
    expect(loadAccounts(dir).map((a) => a.id)).toEqual(['ig2', 'wa1'])
    expect(existsSync(join(dir, 'Partitions', 'ig1'))).toBe(false)
    expect(existsSync(join(dir, 'Partitions', 'ig2', 'Cookies'))).toBe(true)
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('mine')
  })

  it('Remove refuses an id that could point outside its partition dir', async () => {
    const { dir, root } = fixture()
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify([acc('..', 'instagram', 0), acc('../..', 'x', 1)]))
    for (const id of ['..', '../..']) await expect(removeAccount(dir, id, deps())).rejects.toThrow()
    expect(existsSync(join(dir, 'Partitions', 'ig1', 'Cookies'))).toBe(true)
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('mine')
    // loadAccounts now drops unsafe ids, so a hand-edited file exposes no removable account.
    expect(loadAccounts(dir)).toHaveLength(0)
  })
})
