import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { PRODUCT_NAME } from '../product'
import { clickTarget, readPushPayload } from './notification'

const ORIGIN = 'https://app.example.com'

describe('readPushPayload', () => {
  it('shows a valid reminder as English, auto direction, with the icon, the tag and the url', () => {
    const view = readPushPayload({
      title: 'Chapter 3',
      body: 'In 10 min. 09:00–10:30, אלגוריתמים',
      url: '/today',
      tag: 'block:1',
    })
    expect(view.title).toBe('Chapter 3')
    expect(view.options).toMatchObject({
      body: 'In 10 min. 09:00–10:30, אלגוריתמים',
      tag: 'block:1',
      lang: 'en',
      dir: 'auto',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: '/today' },
    })
  })

  it.each([undefined, null, 'text', 42, [], {}, { title: 7, body: {} }])(
    'falls back to the product name and a generic body for %j',
    (data) => {
      const view = readPushPayload(data)
      expect(view.title).toBe(PRODUCT_NAME)
      expect(view.options.body).toBe(en.pwa.pushFallbackBody)
      expect(view.options).toMatchObject({ lang: 'en', dir: 'auto', data: { url: '/today' } })
      expect(view.options.tag).toBeUndefined()
    },
  )

  it('keeps a valid title when only the body is missing', () => {
    const view = readPushPayload({ title: 'Chapter 3' })
    expect(view.title).toBe('Chapter 3')
    expect(view.options.body).toBe(en.pwa.pushFallbackBody)
  })

  it.each([
    'https://evil.com',
    '//evil.com/today',
    '/\\evil.com',
    'today',
    'javascript:alert(1)',
    '',
    '/to\nday',
    5,
  ])('replaces the url %j with /today', (url) => {
    expect(readPushPayload({ title: 't', body: 'b', url }).options.data).toEqual({ url: '/today' })
  })

  it('keeps a relative path with a query', () => {
    expect(readPushPayload({ title: 't', url: '/week?d=2026-11-16' }).options.data).toEqual({
      url: '/week?d=2026-11-16',
    })
  })
})

describe('clickTarget', () => {
  it('resolves the notification url on the app origin', () => {
    expect(clickTarget({ url: '/week' }, ORIGIN)).toBe('https://app.example.com/week')
  })

  it.each([undefined, null, {}, { url: 'https://evil.com/x' }, { url: '//evil.com' }, { url: '/\\evil.com' }])(
    'opens /today for %j',
    (data) => {
      expect(clickTarget(data, ORIGIN)).toBe('https://app.example.com/today')
    },
  )
})
