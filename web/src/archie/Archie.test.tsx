import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { Archie, type ArchieMood, type ArchieSize } from './Archie'
import { MOOD_ART } from './moods'

const MOODS: ArchieMood[] = ['intentions', 'eureka', 'wisdom', 'flow', 'rest', 'joy']
const SIZES: ArchieSize[] = ['avatar', 'card', 'scene']

// The pixel size of the large file of each mood (src/assets/archie/{mood}-900.webp), read from
// the files themselves: the cut-outs are transparent, and each has its own proportions.
const LARGE: Record<ArchieMood, readonly [number, number]> = {
  intentions: [653, 645],
  eureka: [582, 543],
  wisdom: [892, 630],
  flow: [634, 506],
  rest: [900, 599],
  joy: [702, 654],
}

// Anything that would put Archie back in a box: a fill, a gradient, a rounded corner, a shadow.
const BOXED = /^(bg-|from-|to-|via-|rounded|shadow|ring|border|outline)/

function classesOf(el: Element) {
  return [...el.classList]
}

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
    it.each(MOODS)('%s shows the illustration named by en.archie.alt', (mood) => {
      render(<Archie mood={mood} size={size} />)

      expect(screen.getByRole('img', { name: en.archie.alt[mood] })).toBeInTheDocument()
    })
  })

  // S39: Archie has no sky, no frame and no circle. He sits on whatever surface is behind him.
  describe.each(SIZES)('size %s has no background and no frame', (size) => {
    it.each(MOODS)('%s: no fill, gradient, rounded corner or shadow on any element', (mood) => {
      const { container } = render(<Archie mood={mood} size={size} />)
      const root = container.firstElementChild
      if (!root) throw new Error('nothing rendered')

      for (const el of [root, ...root.querySelectorAll('*')]) {
        expect(classesOf(el).filter((name) => BOXED.test(name))).toEqual([])
        expect(el.getAttribute('style') ?? '').not.toMatch(/background|box-shadow|border/)
      }
    })

    it.each(MOODS)('%s: the image has the size of its own cut-out, in its two real widths', (mood) => {
      render(<Archie mood={mood} size={size} />)
      const [width, height] = LARGE[mood]

      const img = screen.getByRole('img', { name: en.archie.alt[mood] })
      expect(img).toHaveAttribute('width', String(width))
      expect(img).toHaveAttribute('height', String(height))
      const widths = (img.getAttribute('srcset') ?? '').split(',').map((part) => part.trim().split(/\s+/)[1])
      expect(widths).toEqual(['450w', `${String(width)}w`])
    })
  })

  it.each(['card', 'scene'] as const)('a %s clips nothing: neither the frame nor the motion layer hides overflow', (size) => {
    for (const mood of MOODS) {
      const { container, unmount } = render(<Archie mood={mood} size={size} />)
      const root = container.firstElementChild
      if (!root) throw new Error('nothing rendered')

      for (const el of [root, ...root.querySelectorAll('*')]) {
        expect(classesOf(el).filter((name) => name.startsWith('overflow-'))).toEqual([])
      }
      unmount()
    }
  })

  it('a scene is never wider than its art, and a card has no cap of its own', () => {
    for (const mood of MOODS) {
      const { container, unmount } = render(
        <>
          <Archie mood={mood} size="scene" />
          <Archie mood={mood} size="card" />
        </>,
      )
      const scene = container.querySelector<HTMLElement>('[data-size="scene"]')
      const card = container.querySelector<HTMLElement>('[data-size="card"]')

      expect(scene?.style.maxWidth).toBe(`${String(LARGE[mood][0])}px`)
      expect(card?.style.maxWidth).toBe('')
      unmount()
    }
  })

  // The avatar is a bust: the head and the shoulders, cut out of the same image. The crop lies
  // inside the image, so the box never shows an empty band beside or above him.
  it.each(MOODS)('the avatar of %s is a crop inside the image', (mood) => {
    const { bust, width, height } = MOOD_ART[mood]

    expect(bust.x).toBeGreaterThanOrEqual(0)
    expect(bust.y).toBeGreaterThanOrEqual(0)
    expect(bust.x + bust.size).toBeLessThanOrEqual(1)
    // The crop is a square: its height is the same number of pixels as its width.
    expect(bust.y + (bust.size * width) / height).toBeLessThanOrEqual(1)
    // The head fills the avatar: the crop is under half the width of the cut-out.
    expect(bust.size).toBeLessThan(0.5)
  })

  it('the avatar places the image by percent of its box, so it follows any size', () => {
    render(<Archie mood="joy" size="avatar" />)
    const { bust, width, height } = MOOD_ART.joy

    const img = screen.getByRole('img', { name: en.archie.alt.joy })
    expect(parseFloat(img.style.width)).toBeCloseTo(100 / bust.size, 1)
    expect(parseFloat(img.style.left)).toBeCloseTo((-bust.x / bust.size) * 100, 1)
    expect(parseFloat(img.style.top)).toBeCloseTo((-bust.y / bust.size) * (height / width) * 100, 1)
  })

  it('a decorative Archie has an empty alt, so a screen reader skips it', () => {
    const { container } = render(<Archie mood="joy" decorative />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('eager loads at once, for an Archie that is always above the fold (the logo)', () => {
    render(<Archie mood="joy" size="avatar" eager />)

    expect(screen.getByRole('img', { name: en.archie.alt.joy })).toHaveAttribute('loading', 'eager')
  })

  it('the avatar asks for a width close to what it shows, so a phone takes the small file', () => {
    render(<Archie mood="joy" size="avatar" />)

    expect(screen.getByRole('img', { name: en.archie.alt.joy })).toHaveAttribute('sizes', '128px')
  })

  it('loads lazily and asynchronously, from webp in two widths', () => {
    render(<Archie mood="rest" />)

    const img = screen.getByRole('img', { name: en.archie.alt.rest })
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    const widths = (img.getAttribute('srcset') ?? '').split(',').map((part) => part.trim().split(/\s+/))
    expect(widths).toHaveLength(2)
    expect(widths.map(([, w]) => w)).toEqual(['450w', '900w'])
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

  it('under prefers-reduced-motion nothing breathes either: the illustration stands still', () => {
    mockReducedMotion(true)
    const { container } = render(<Archie mood="joy" />)
    const frame = container.firstElementChild
    if (!frame) throw new Error('nothing rendered')

    setInView(frame, true)

    expect(container.querySelector('img')).not.toHaveClass('archie-breathe')
  })

  it('the motion layer measures in the scale of the art, whatever the width of the cut-out', () => {
    const { container } = render(<Archie mood="eureka" />)
    const frame = container.firstElementChild as HTMLElement

    // One unit is 9 pixels of the art: 900 / 582 of a percent of the frame's width.
    expect(frame.style.getPropertyValue('--archie-u')).toBe('1.5464cqw')
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
