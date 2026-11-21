import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ARCHI_ICONS, DAYPART_ICON, KIND_ICON } from './index'

const ICONS = Object.entries(ARCHI_ICONS)

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('no svg')
  return svg
}

describe('the Archi icon set', () => {
  it('lists every custom icon under its own name', () => {
    expect(ICONS.length).toBeGreaterThanOrEqual(24)
    for (const [name] of ICONS) expect(name).toMatch(/^[A-Z][A-Za-z]+Icon$/)
  })

  describe.each(ICONS)('%s', (_name, Icon) => {
    it('draws on the 24 grid with the line of the set, in the current colour', () => {
      const { container } = render(<Icon />)
      const svg = svgOf(container)
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('fill', 'none')
      expect(svg).toHaveAttribute('stroke-width', '1.75')
      expect(svg).toHaveAttribute('stroke-linecap', 'round')
      expect(svg).toHaveAttribute('stroke-linejoin', 'round')
      expect(svg.children.length).toBeGreaterThan(0)
    })

    it('has no fixed colour anywhere in its markup', () => {
      const { container } = render(<Icon />)
      const markup = container.innerHTML
      expect(markup).not.toContain('#')
      expect(markup).not.toContain('rgb(')
      expect(markup).not.toMatch(/hsl\(|oklch\(/)
      for (const node of container.querySelectorAll('[fill], [stroke]')) {
        for (const attribute of ['fill', 'stroke']) {
          const value = node.getAttribute(attribute)
          if (value !== null) expect(['currentColor', 'none']).toContain(value)
        }
      }
    })

    it('is hidden from assistive technology when it has no label', () => {
      const { container } = render(<Icon />)
      const svg = svgOf(container)
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('focusable', 'false')
      expect(svg).not.toHaveAttribute('role')
      expect(svg).not.toHaveAttribute('aria-label')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('is an image with an accessible name when it has a label', () => {
      const { container } = render(<Icon label="Streak" />)
      const svg = svgOf(container)
      expect(screen.getByRole('img', { name: 'Streak' })).toBe(svg)
      expect(svg).not.toHaveAttribute('aria-hidden')
    })

    it('is 20px by default and takes the size it is given', () => {
      const { container, rerender } = render(<Icon />)
      expect(svgOf(container)).toHaveAttribute('width', '20')
      expect(svgOf(container)).toHaveAttribute('height', '20')
      rerender(<Icon size={32} />)
      expect(svgOf(container)).toHaveAttribute('width', '32')
      expect(svgOf(container)).toHaveAttribute('height', '32')
    })

    it('passes its class name through', () => {
      const { container } = render(<Icon className="text-brand" />)
      expect(svgOf(container)).toHaveClass('text-brand')
    })
  })

  it('has an icon for each of the six task kinds', () => {
    expect(Object.keys(KIND_ICON).sort()).toEqual(
      ['custom', 'learn', 'practice', 'review', 'simulation', 'simulation_review'],
    )
    for (const Icon of Object.values(KIND_ICON)) expect(Object.values(ARCHI_ICONS)).toContain(Icon)
  })

  it('tells learning, practice, review and a simulation apart', () => {
    const four = [KIND_ICON.learn, KIND_ICON.practice, KIND_ICON.review, KIND_ICON.simulation]
    expect(new Set(four).size).toBe(4)
  })

  it('has an icon for each of the four parts of the day', () => {
    expect(Object.keys(DAYPART_ICON).sort()).toEqual(['afternoon', 'evening', 'morning', 'night'])
    expect(new Set(Object.values(DAYPART_ICON)).size).toBe(4)
    for (const Icon of Object.values(DAYPART_ICON)) expect(Object.values(ARCHI_ICONS)).toContain(Icon)
  })
})
