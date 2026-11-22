import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STICKY_ATTRIBUTE, useAutoScroll } from './useAutoScroll'

// The phone's window scroll (S32 screenshot pass, S2). jsdom lays nothing out, so each element
// says where it is through a stubbed getBoundingClientRect, in px from the top of the page at
// scroll 0.

const TOPS: Record<string, { top: number; height: number }> = {
  sticky: { top: 0, height: 130 },
  banner: { top: 130, height: 90 },
  columns: { top: 220, height: 1200 },
}

function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = TOPS[this.getAttribute('data-box') ?? ''] ?? { top: 0, height: 0 }
    return { top: box.top, height: box.height, bottom: box.top + box.height, left: 0, right: 390, width: 390, x: 0, y: box.top, toJSON: () => ({}) }
  })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 2000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 })
  const scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  return scrollTo
}

function Page({ banner, nowY }: { banner: boolean; nowY: number }) {
  const grid = useRef<HTMLDivElement>(null)
  const none = useRef<HTMLElement>(null)
  useAutoScroll(none, grid, 'day|2026-11-24', true)
  return (
    <>
      <div data-box="sticky" {...{ [STICKY_ATTRIBUTE]: '' }} />
      {banner ? <div data-box="banner" data-banner-row="review" /> : null}
      <div ref={grid}>
        <div data-first-y="0" data-now-y={String(nowY)}>
          <div data-box="columns" data-date="2026-11-24" />
        </div>
      </div>
    </>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useAutoScroll on a phone', () => {
  it('without a banner, puts now a third of the way down under the sticky header', () => {
    const scrollTo = stubLayout()
    render(<Page banner={false} nowY={600} />)
    // 220 + 600 - 130 - (844 - 130) / 3
    expect(scrollTo).toHaveBeenCalledWith({ top: 220 + 600 - 130 - (844 - 130) / 3, behavior: 'auto' })
  })

  it('with a banner, never scrolls it under the sticky header', () => {
    const scrollTo = stubLayout()
    render(<Page banner nowY={600} />)
    // The banner's top (130) stays at the bottom of the sticky header (130): no scroll at all.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
