import { describe, expect, it } from 'vitest'
import { candidatesFor, pickTarget, safeWebUrl, siblingsFor } from '../src/main/servicelinks'
import { PRESETS } from '../src/main/presets'

const acc = (id: string, serviceId: string, order: number, custom?: { name: string; url: string; hosts: string[] }) =>
  ({ id, serviceId, label: id, colour: '#6d5bd0', order, ...(custom ? { custom } : {}) }) as never
const ids = (r: { id: string }[]) => r.map((a) => a.id)

const all = [
  acc('wa', 'whatsapp', 0), acc('ig1', 'instagram', 1), acc('th', 'threads', 2), acc('fb', 'facebook', 3),
  acc('ig2', 'instagram', 4), acc('c1', 'custom', 5, { name: 'Wiki', url: 'http://127.0.0.1:8000/', hosts: ['127.0.0.1'] })
]

describe('home hosts (D40)', () => {
  it('match the decision', () => {
    const h = Object.fromEntries(PRESETS.map((p) => [p.id, p.homeHosts]))
    expect(h).toEqual({
      whatsapp: ['whatsapp.com'], discord: ['discord.com', 'discord.gg'], instagram: ['instagram.com'],
      facebook: ['facebook.com', 'fb.com'], x: ['x.com', 'twitter.com'], threads: ['threads.com', 'threads.net'],
      tiktok: ['tiktok.com']
    })
  })
})

describe('candidatesFor', () => {
  it('an instagram link goes to instagram accounts only, in sidebar order (feeds by order)', () => {
    expect(ids(candidatesFor('https://www.instagram.com/p/abc/', all, []))).toEqual(['ig1', 'ig2'])
  })
  it('threads.net goes to threads', () => {
    expect(ids(candidatesFor('https://www.threads.net/@x', all, []))).toEqual(['th'])
  })
  it('a subdomain matches', () => {
    expect(ids(candidatesFor('https://m.facebook.com/x', all, []))).toEqual(['fb'])
  })
  it('a redirect wrapper is unwrapped', () => {
    expect(ids(candidatesFor('https://l.instagram.com/?u=' + encodeURIComponent('https://www.threads.com/@a'), all, []))).toEqual(['th'])
  })
  it('a disabled service is skipped', () => {
    expect(candidatesFor('https://instagram.com/x', all, ['instagram'])).toEqual([])
  })
  it('a custom account matches its own hosts', () => {
    expect(ids(candidatesFor('http://127.0.0.1:8000/page', all, []))).toEqual(['c1'])
  })
  it('non-http, bad and unknown urls give none', () => {
    expect(candidatesFor('mailto:a@instagram.com', all, [])).toEqual([])
    expect(candidatesFor('file:///etc/passwd', all, [])).toEqual([])
    expect(candidatesFor('not a url', all, [])).toEqual([])
    expect(candidatesFor('https://example.org/', all, [])).toEqual([])
  })
  it('chat accounts come before feeds', () => {
    const a = [acc('x1', 'x', 0), acc('d1', 'discord', 1)]
    expect(ids(candidatesFor('https://discord.gg/abc', a, []))).toEqual(['d1'])
    const m = [acc('f', 'facebook', 0), acc('f2', 'facebook', 1)]
    expect(ids(candidatesFor('https://fb.com/x', m, []))).toEqual(['f', 'f2'])
  })
})

describe('siblingsFor (D46)', () => {
  const th = (id: string, order: number, shareWith?: string) =>
    ({ id, serviceId: 'threads', label: id, colour: '#6d5bd0', order, ...(shareWith ? { shareWith } : {}) }) as never
  const list = [th('t1', 0), acc('ig1', 'instagram', 1), th('t2', 3), th('t3', 2), th('t4', 4, 't1')]
  it('other threads accounts on another partition, sidebar order, not itself', () => {
    expect(ids(siblingsFor(list[0], list, []))).toEqual(['t3', 't2'])
  })
  it('none when the service is disabled or the only other shares the partition', () => {
    expect(siblingsFor(list[0], list, ['threads'])).toEqual([])
    expect(siblingsFor(list[0], [list[0], list[4]], [])).toEqual([])
  })
  it('none when alone', () => {
    expect(siblingsFor(list[1], list, [])).toEqual([])
  })
})

describe('pickTarget (D46)', () => {
  const homes = ['threads.com', 'threads.net']
  it('a link on a home host (subdomain too) wins', () => {
    expect(pickTarget('https://www.threads.com/@a/post/1', 'https://threads.com/p', 'https://threads.com/', homes)).toBe('https://www.threads.com/@a/post/1')
  })
  it('unwraps a redirect link', () => {
    expect(pickTarget('https://l.threads.com/?u=https%3A%2F%2Fthreads.net%2Fx', '', 'https://threads.com/', homes)).toBe('https://threads.net/x')
  })
  it('a link on another host falls to the post, then the page', () => {
    expect(pickTarget('https://example.org/a', 'https://threads.com/p', 'https://threads.com/', homes)).toBe('https://threads.com/p')
    expect(pickTarget('', null, 'https://threads.com/feed', homes)).toBe('https://threads.com/feed')
  })
  it('a non-http link is ignored', () => {
    expect(pickTarget('javascript:alert(1)', '', 'https://threads.com/feed', homes)).toBe('https://threads.com/feed')
  })
})

describe('safeWebUrl', () => {
  it('accepts an https post URL and rejects non-web schemes', () => {
    expect(safeWebUrl('https://www.threads.com/@a/post/1')).toBe('https://www.threads.com/@a/post/1')
    for (const u of ['javascript:alert(1)', 'javascript:.../post/', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'mailto:a@b.c', 'not a url', null, 42])
      expect(safeWebUrl(u)).toBeNull()
  })
  it('drops a page-controlled pickTarget result that is not a web URL', () => {
    const homes = ['threads.com']
    expect(safeWebUrl(pickTarget('javascript:.../post/', null, 'javascript:.../post/', homes))).toBeNull()
    expect(safeWebUrl(pickTarget('https://www.threads.com/@a/post/1', null, '', homes))).toBe('https://www.threads.com/@a/post/1')
  })
})

describe('siblingsFor custom sites (D46)', () => {
  const c = (id: string, host: string) => acc(id, 'custom', 0, { name: id, url: `http://${host}/`, hosts: [host] })
  it('only custom accounts of the same site are siblings', () => {
    const list = [c('a', 'x.test'), c('b', 'y.test'), c('d', 'x.test')]
    expect(ids(siblingsFor(list[0], list, []))).toEqual(['d'])
  })
})
