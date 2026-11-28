import { describe, expect, it } from 'vitest'
import type { Account } from '../src/main/accounts'
import { accountsToUnload } from '../src/main/services'

const acc = (id: string, serviceId: string): Account => ({ id, serviceId, label: id, colour: '#6d5bd0', order: 0 })

describe('accountsToUnload', () => {
  it('returns the ids of the disabled service only', () => {
    const accounts = [acc('w1', 'whatsapp'), acc('w2', 'whatsapp'), acc('t1', 'telegram'), acc('x1', 'x')]
    expect(accountsToUnload(accounts, ['whatsapp'])).toEqual(['w1', 'w2'])
    expect(accountsToUnload(accounts, new Set(['whatsapp', 'x']))).toEqual(['w1', 'w2', 'x1'])
    expect(accountsToUnload(accounts, [])).toEqual([])
  })

  it('never returns a row for a service that is still enabled', () => {
    const accounts = [acc('w1', 'whatsapp'), acc('t1', 'telegram')]
    expect(accountsToUnload(accounts, ['whatsapp'])).not.toContain('t1')
  })
})
