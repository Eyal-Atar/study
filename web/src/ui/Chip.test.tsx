import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chip } from './Chip'
import { SproutIcon, XpSparkIcon } from './icons'

describe('Chip', () => {
  it('the gold chip is gold-ink on gold-soft, with a hidden icon and the text', () => {
    render(
      <Chip tone="gold" icon={XpSparkIcon}>
        +50 XP
      </Chip>,
    )
    const chip = screen.getByText('+50 XP').closest('span.rounded-full')
    expect(chip).toHaveClass('bg-gold-soft', 'text-gold-ink', 'inline-flex', 'items-center', 'gap-1.5', 'px-3', 'py-1', 'text-small', 'font-semibold', 'tabular-nums')
    expect(chip?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('the leaf chip is brand-strong on brand-soft', () => {
    render(
      <Chip tone="leaf" icon={SproutIcon}>
        The first seed in your garden
      </Chip>,
    )
    const chip = screen.getByText('The first seed in your garden').closest('span.rounded-full')
    expect(chip).toHaveClass('bg-brand-soft', 'text-brand-strong')
  })

  it('with a label the visible text is hidden from a screen reader and the label is read instead', () => {
    render(
      <Chip tone="gold" icon={XpSparkIcon} label="I gave you 50 XP for your first plan">
        +50 XP
      </Chip>,
    )
    expect(screen.getByText('+50 XP')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('I gave you 50 XP for your first plan')).toHaveClass('sr-only')
  })

  it('has no animation', () => {
    const { container } = render(
      <Chip tone="leaf" icon={SproutIcon}>
        x
      </Chip>,
    )
    expect(container.innerHTML).not.toMatch(/animate|transition/)
  })
})
