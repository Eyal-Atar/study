import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { makeBadges, makeProgress } from '../progress/testFixtures'
import { CelebrationSheet } from './CelebrationSheet'
import type { Celebration } from './rules'

// The "before and after" of a new stage (S33 fix wave 10): the garden "before" is the garden as it
// was before this Done, so a badge earned by the same Done is not a stone in it yet.

const t = en.garden.celebrate

const STAGE_AND_BADGE: Celebration = {
  lead: 'stage',
  level: 3,
  stageBefore: 'seed',
  stageAfter: 'sprout',
  badges: ['iron_will_7'],
  day: null,
}

function gardenUnder(label: string) {
  const heading = screen.getByText(label, { exact: true })
  const box = heading.parentElement
  if (box === null) throw new Error(`no garden under ${label}`)
  return box
}

describe('CelebrationSheet: before and after', () => {
  it('the garden before holds no stone of a badge earned in the same Done; after holds it', () => {
    const progress = makeProgress({
      level: 3,
      badges: makeBadges({ first_task: '2026-11-01T10:00:00Z', iron_will_7: '2026-11-16T09:00:00Z' }),
    })
    render(
      <CelebrationSheet
        celebration={STAGE_AND_BADGE}
        progress={progress}
        todayBlocks={[]}
        tomorrowFirst={null}
        gardenExams={[]}
        tz="Asia/Jerusalem"
        onClose={() => undefined}
      />,
    )
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(t.before)).toBeInTheDocument()

    const before = gardenUnder(t.before)
    const after = gardenUnder(t.after)
    expect([...before.querySelectorAll('[data-item^="stone:"]')].map((s) => s.getAttribute('data-item'))).toEqual(['stone:first_task'])
    expect([...after.querySelectorAll('[data-item^="stone:"]')].map((s) => s.getAttribute('data-item')).sort()).toEqual([
      'stone:first_task',
      'stone:iron_will_7',
    ])
  })
})

// Fix wave 5: at 200% text the sheet is taller than the phone. Its content and Close sit in the box
// that scrolls (85% of the visual viewport, Dialog's SCROLLER), so the content scrolls inside the
// sheet and Close is reached by scrolling; Archi stands outside that box.
describe('CelebrationSheet: a sheet taller than the screen', () => {
  it('its body and Close are inside the box that scrolls, limited to the visual viewport', () => {
    render(
      <CelebrationSheet
        celebration={STAGE_AND_BADGE}
        progress={makeProgress({ level: 3 })}
        todayBlocks={[]}
        tomorrowFirst={null}
        gardenExams={[]}
        tz="Asia/Jerusalem"
        onClose={() => undefined}
      />,
    )
    const dialog = screen.getByRole('dialog')
    const scroller = dialog.parentElement
    expect(scroller).toHaveClass('overflow-y-auto', 'max-h-[calc(var(--visual-viewport-height)*0.85)]')
    // The primary Close of the footer, and the X: both named Close, both inside.
    const closes = within(dialog).getAllByRole('button', { name: t.close })
    expect(closes).toHaveLength(2)
    for (const close of closes) expect(scroller).toContainElement(close)
    expect(scroller).toContainElement(within(dialog).getByText(t.stageBody(3)))
  })
})
