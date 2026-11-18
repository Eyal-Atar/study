import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
import { Archie, type ArchieMood, type ArchieSize } from './Archie'

const MOODS: ArchieMood[] = ['intentions', 'eureka', 'wisdom', 'flow', 'rest', 'joy']
const SIZES: ArchieSize[] = ['avatar', 'card', 'scene']

// A stand-in for IntersectionObserver: jsdom has none. Each instance keeps its callback and the
// elements it watches, so a test can say when an element enters or leaves the screen.
class FakeObserver {
  static instances: FakeObserver[] = []
  readonly elements = new Set<Element>()
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.elements.add(el)
  }
  unobserve(el: Element) {
    this.elements.delete(el)
  }
  disconnect() {
    this.elements.clear()
  }
  takeRecords() {
    return []
  }
}

// Tells every observer that watches the element whether it is on screen now.
function setInView(el: Element, isIntersecting: boolean) {
  act(() => {
    for (const io of FakeObserver.instances) {
      if (!io.elements.has(el)) continue
      const entry = { target: el, isIntersecting } as unknown as IntersectionObserverEntry
      io.callback([entry], io as unknown as IntersectionObserver)
    }
  })
}

// prefers-reduced-motion as the system answers it; every other query is false.
function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function motionLayer(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-part="motion"]')
}

beforeEach(() => {
  FakeObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  mockReducedMotion(false)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Archie', () => {
  describe.each(SIZES)('size %s', (size) => {
    it.each(MOODS)('%s shows the illustration named by he.archie.alt', (mood) => {
      render(<Archie mood={mood} size={size} />)

      expect(screen.getByRole('img', { name: he.archie.alt[mood] })).toBeInTheDocument()
    })
  })

  it('a decorative Archie has an empty alt, so a screen reader skips it', () => {
    const { container } = render(<Archie mood="joy" decorative />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('eager loads at once, for an Archie that is always above the fold (the logo)', () => {
    render(<Archie mood="joy" size="avatar" eager />)

    expect(screen.getByRole('img', { name: he.archie.alt.joy })).toHaveAttribute('loading', 'eager')
  })

  it('the avatar asks for a width close to what it shows, so a phone takes the small file', () => {
    render(<Archie mood="joy" size="avatar" />)

    expect(screen.getByRole('img', { name: he.archie.alt.joy })).toHaveAttribute('sizes', '104px')
  })

  it('loads lazily and asynchronously, from webp in two widths', () => {
    render(<Archie mood="rest" />)

    const img = screen.getByRole('img', { name: he.archie.alt.rest })
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    const widths = (img.getAttribute('srcset') ?? '').split(',').map((part) => part.trim().split(/\s+/))
    expect(widths).toHaveLength(2)
    expect(widths.map(([, w]) => w)).toEqual(['450w', expect.stringMatching(/^\d{3}w$/)])
    for (const [url] of widths) expect(url).toMatch(/\.webp$/)
    expect(img).toHaveAttribute('sizes')
  })

  it('the avatar has no motion layer', () => {
    const { container } = render(<Archie mood="joy" size="avatar" />)

    expect(motionLayer(container)).toBeNull()
  })

  it.each(['card', 'scene'] as const)('a %s has a motion layer hidden from assistive tech, marked with its mood', (size) => {
    for (const mood of MOODS) {
      const { container, unmount } = render(<Archie mood={mood} size={size} />)

      const layer = motionLayer(container)
      expect(layer).not.toBeNull()
      expect(layer).toHaveAttribute('aria-hidden', 'true')
      expect(layer).toHaveAttribute('data-mood', mood)
      unmount()
    }
  })

  it('the layer starts when the frame comes into view and stops when it leaves', () => {
    const { container } = render(<Archie mood="eureka" />)
    const layer = motionLayer(container)
    const frame = layer?.parentElement
    if (!layer || !frame) throw new Error('no motion layer')
    expect(layer).not.toHaveAttribute('data-playing')

    setInView(frame, true)
    expect(layer).toHaveAttribute('data-playing')
    // The emitters run: particles appear in the layer.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(layer.querySelector('[data-part="particles"]')?.childElementCount).toBeGreaterThan(0)

    setInView(frame, false)
    expect(layer).not.toHaveAttribute('data-playing')
    // Stopped: no new particles once it has left the screen.
    const count = layer.querySelector('[data-part="particles"]')?.childElementCount
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(layer.querySelector('[data-part="particles"]')?.childElementCount).toBe(count)
  })

  it('under prefers-reduced-motion the layer never plays, not even in view', () => {
    mockReducedMotion(true)
    const { container } = render(<Archie mood="flow" size="scene" />)
    const layer = motionLayer(container)
    const frame = layer?.parentElement
    if (!layer || !frame) throw new Error('no motion layer')

    setInView(frame, true)
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(layer).not.toHaveAttribute('data-playing')
    expect(layer.querySelector('[data-part="particles"]')?.childElementCount ?? 0).toBe(0)
  })

  it('the layer does not take clicks', () => {
    const { container } = render(<Archie mood="wisdom" />)

    expect(motionLayer(container)).toHaveClass('pointer-events-none')
  })

  it('passes className to the outer element, so the place that uses it sizes it', () => {
    const { container } = render(<Archie mood="joy" size="avatar" className="size-16" />)

    expect(container.firstElementChild).toHaveClass('size-16')
  })
})
