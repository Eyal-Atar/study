import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { List, ListRow } from './List'
import { ProgressBar } from './ProgressBar'
import { SectionHeading } from './SectionHeading'
import { TextLink } from './TextLink'

describe('Card', () => {
  it('shows its children inside a lined surface, never a shadow, and passes div props through', () => {
    render(
      <Card role="region" aria-label="המשימה הבאה" id="next" className="mt-4">
        תרגול תוחלת
      </Card>,
    )
    const card = screen.getByRole('region', { name: 'המשימה הבאה' })
    expect(card).toHaveTextContent('תרגול תוחלת')
    expect(card).toHaveAttribute('id', 'next')
    for (const name of ['rounded-card', 'border', 'border-line', 'bg-surface', 'p-card', 'mt-4']) {
      expect(card).toHaveClass(name)
    }
    expect(card.className).not.toMatch(/shadow/)
  })

  it.each([
    ['danger', 'border-danger', 'bg-danger-soft'],
    ['warning', 'border-warning', 'bg-warning-soft'],
    ['success', 'border-success', 'bg-success-soft'],
  ] as const)('a %s card has the state border and its soft background, with ink text', (tone, border, background) => {
    render(
      <Card tone={tone} role="group" aria-label="מצב">
        תוכן
      </Card>,
    )
    const card = screen.getByRole('group', { name: 'מצב' })
    expect(card).toHaveClass(border, background, 'text-ink')
    expect(card).not.toHaveClass('border-line', 'bg-surface')
    expect(card.className).not.toMatch(/shadow/)
  })

  it('without a title it has no heading and no aria-labelledby', () => {
    render(<Card role="group">תוכן</Card>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-labelledby')
  })

  it.each([
    ['plain', 'text-ink'],
    ['danger', 'text-danger'],
    ['warning', 'text-warning'],
    ['success', 'text-success'],
  ] as const)('a %s card with a title starts with an h2 in the colour of its tone', (tone, colour) => {
    render(
      <Card tone={tone} title="הקובץ לא נקרא">
        <p>אפשר להעלות אותו שוב.</p>
      </Card>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'הקובץ לא נקרא' })
    expect(heading).toHaveClass('text-body', 'font-semibold', 'mb-2', colour)
    const card = heading.parentElement as HTMLElement
    expect(card.firstElementChild).toBe(heading)
    expect(card).toHaveTextContent('אפשר להעלות אותו שוב.')
    // Without a role an accessible name would be ignored, so none is set.
    expect(card).not.toHaveAttribute('aria-labelledby')
  })

  it('titleLevel makes the heading an h3', () => {
    render(<Card title="הלוח מוכן" titleLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'הלוח מוכן' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('a card with a role is named by its title, unless the caller names it', () => {
    render(
      <>
        <Card role="region" title="המשימה הבאה">
          תוכן
        </Card>
        <Card role="group" aria-label="שם אחר" title="כותרת">
          תוכן
        </Card>
      </>,
    )
    expect(screen.getByRole('region', { name: 'המשימה הבאה' })).toContainElement(screen.getByRole('heading', { name: 'המשימה הבאה' }))
    expect(screen.getByRole('group', { name: 'שם אחר' })).not.toHaveAttribute('aria-labelledby')
  })
})

describe('SectionHeading', () => {
  it('is an h2 that reads as a label: small, semibold, muted', () => {
    render(<SectionHeading id="today">עוד היום</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 2, name: 'עוד היום' })
    expect(heading).toHaveAttribute('id', 'today')
    expect(heading).toHaveClass('text-small', 'font-semibold', 'text-ink-muted')
  })

  it('level 3 is an h3, and it takes a class', () => {
    render(
      <SectionHeading level={3} className="mb-2">
        קבצים
      </SectionHeading>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'קבצים' })).toHaveClass('text-small', 'mb-2')
  })
})

describe('List', () => {
  it('is a named list of rows with a title and a subtitle, separated by a line and not boxed', () => {
    render(
      <List aria-label="עוד היום">
        <ListRow leading="10:00" title="תרגול תוחלת" subtitle="הסתברות, תרגול. שעה" />
        <ListRow title="סיכום פרק 3" />
      </List>,
    )
    const list = screen.getByRole('list', { name: 'עוד היום' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const first = rows[0] as HTMLElement
    expect(first).toHaveTextContent('10:00')
    expect(within(first).getByText('תרגול תוחלת')).toHaveClass('text-body', 'font-semibold', 'text-ink')
    expect(within(first).getByText('הסתברות, תרגול. שעה')).toHaveClass('text-small', 'text-ink-muted')
    expect(within(first).getByText('10:00')).toHaveClass('tabular-nums', 'shrink-0')
    for (const row of rows) {
      expect(row).toHaveClass('min-h-16', 'border-b', 'border-line')
      expect(row.className).not.toMatch(/rounded-card|bg-surface(\s|$)|shadow/)
    }
    // No link without `to`.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('a row with `to` is a link named by the title, and the control at its end presses separately', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route
            path="/exams"
            element={
              <List>
                <ListRow
                  to="/exams/e1"
                  title="חדו״א 1"
                  subtitle="בעוד 12 ימים"
                  trailing={
                    <Button variant="secondary" onPress={onPress}>
                      פעולות
                    </Button>
                  }
                />
              </List>
            }
          />
          <Route path="/exams/e1" element={<p>עמוד המבחן</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const row = screen.getByRole('listitem')
    const link = within(row).getByRole('link', { name: 'חדו״א 1' })
    expect(link).toHaveAttribute('href', '/exams/e1')
    // The link is stretched over the whole row, and the control sits above it.
    expect(row).toHaveClass('relative', 'hover:bg-surface-muted')
    expect(link).toHaveClass('after:absolute', 'after:inset-0', 'outline-none', 'focus-visible:after:ring-2', 'focus-visible:after:ring-brand')
    const button = within(row).getByRole('button', { name: 'פעולות' })
    expect(button.parentElement).toHaveClass('relative', 'z-10', 'shrink-0', 'flex', 'items-center', 'gap-2', 'min-w-0', 'max-w-[50%]')

    await user.click(button)
    expect(onPress).toHaveBeenCalledOnce()
    expect(screen.queryByText('עמוד המבחן')).not.toBeInTheDocument()

    await user.click(link)
    expect(screen.getByText('עמוד המבחן')).toBeInTheDocument()
  })

  it('the link of a row takes keyboard focus before the control at its end', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <List>
          <ListRow to="/exams/e1" title="חדו״א 1" trailing={<Button variant="secondary">פעולות</Button>} />
        </List>
      </MemoryRouter>,
    )
    await user.tab()
    expect(screen.getByRole('link', { name: 'חדו״א 1' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'פעולות' })).toHaveFocus()
  })

  it('a row with `onPress` is a button named by the title, stretched over the row like the link', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const onTrailing = vi.fn()
    render(
      <List>
        <ListRow
          onPress={onPress}
          title="תרגול תוחלת"
          subtitle="הסתברות"
          trailing={
            <Button variant="secondary" onPress={onTrailing}>
              פעולות
            </Button>
          }
        />
      </List>,
    )
    const row = screen.getByRole('listitem')
    const title = within(row).getByRole('button', { name: 'תרגול תוחלת' })
    expect(title).toHaveAttribute('type', 'button')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(row).toHaveClass('relative', 'hover:bg-surface-muted')
    expect(title).toHaveClass(
      'text-start',
      'text-body',
      'font-semibold',
      'after:absolute',
      'after:inset-0',
      'outline-none',
      'focus-visible:after:ring-2',
      'focus-visible:after:ring-brand',
    )

    // The title takes the keyboard focus first, and Enter presses it.
    await user.tab()
    expect(title).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledTimes(1)

    await user.click(title)
    expect(onPress).toHaveBeenCalledTimes(2)

    await user.click(within(row).getByRole('button', { name: 'פעולות' }))
    expect(onTrailing).toHaveBeenCalledOnce()
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('`to` wins when a row is given both `to` and `onPress`', () => {
    render(
      <MemoryRouter>
        <List>
          <ListRow to="/exams/e1" onPress={vi.fn()} title="חדו״א 1" />
        </List>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'חדו״א 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('the end of a row holds several controls in a line, and a long badge is cut instead of widening the row', () => {
    const long = 'תג ארוך מאוד '.repeat(8).trim()
    render(
      <List>
        <ListRow
          title="תרגול תוחלת"
          trailing={
            <>
              <Badge tone="warning">{long}</Badge>
              <Button variant="secondary">פעולות</Button>
            </>
          }
        />
      </List>,
    )
    const badge = screen.getByText(long)
    expect(badge).toHaveClass('truncate', 'max-w-full')
    expect(badge.parentElement).toHaveClass('flex', 'min-w-0', 'max-w-[50%]', 'shrink-0', 'items-center', 'gap-2')
    expect(badge.parentElement).toContainElement(screen.getByRole('button', { name: 'פעולות' }))
  })

  it('a done row strikes its title through in the muted colour and the normal weight', () => {
    render(
      <MemoryRouter>
        <List>
          <ListRow done title="תרגול תוחלת" />
          <ListRow done to="/tasks/t1" title="סיכום פרק 3" />
        </List>
      </MemoryRouter>,
    )
    for (const title of [screen.getByText('תרגול תוחלת'), screen.getByRole('link', { name: 'סיכום פרק 3' })]) {
      expect(title).toHaveClass('line-through', 'text-ink-muted', 'font-normal')
      expect(title).not.toHaveClass('font-semibold', 'text-ink')
    }
  })

  it('a long title without spaces wraps inside the row instead of widening the page', () => {
    const long = 'א'.repeat(60)
    render(
      <List>
        <ListRow leading="10:00" title={long} trailing={<Button variant="secondary">פעולות</Button>} />
      </List>,
    )
    const title = screen.getByText(long)
    expect(title).toHaveClass('break-words')
    expect(title.parentElement).toHaveClass('min-w-0', 'flex-1')
  })
})

describe('Badge', () => {
  it.each([
    ['brand', 'עכשיו', 'bg-brand-soft', 'text-brand-strong'],
    ['success', 'בוצע', 'bg-success-soft', 'text-success'],
    ['warning', 'עבר הזמן', 'bg-warning-soft', 'text-warning'],
    ['neutral', 'דולג', 'bg-surface-muted', 'text-ink-muted'],
  ] as const)('a %s badge shows its text on the soft colour of its state', (tone, text, background, colour) => {
    render(<Badge tone={tone}>{text}</Badge>)
    const badge = screen.getByText(text)
    expect(badge.tagName).toBe('SPAN')
    expect(badge).toHaveClass('rounded-badge', 'px-2', 'text-small', 'font-semibold', background, colour)
  })

  it('a long badge stays on one line and is cut with an ellipsis at the width of its container', () => {
    const long = 'מחכה לאישור של המרצה על מועד חדש '.repeat(4).trim()
    render(<Badge tone="neutral">{long}</Badge>)
    const badge = screen.getByText(long)
    // truncate: overflow hidden, an ellipsis, and no wrapping. max-w-full needs a block box.
    expect(badge).toHaveClass('inline-block', 'max-w-full', 'truncate', 'align-middle')
    expect(badge).not.toHaveClass('inline-flex')
  })
})

describe('ProgressBar', () => {
  it('is a progressbar named by its label, and says its value in words', () => {
    render(<ProgressBar label="התקדמות היום" value={60} max={345} valueText="60 מתוך 345 דקות" />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות היום' })
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect(bar).toHaveAttribute('aria-valuemax', '345')
    expect(bar).toHaveAttribute('aria-valuetext', '60 מתוך 345 דקות')
    expect(within(bar).getByText('התקדמות היום')).toHaveClass('text-small', 'text-ink-muted')
    expect(within(bar).getByText('60 מתוך 345 דקות')).toHaveClass('text-small', 'font-semibold', 'tabular-nums')
    const fill = bar.querySelector('[data-fill]')
    expect(fill).toHaveClass('bg-success', 'rounded-full')
    expect(fill?.parentElement).toHaveClass('h-1', 'rounded-full', 'bg-line')
    expect((fill as HTMLElement).style.width).toMatch(/^17\.39/)
  })

  it('max defaults to 100, and a value outside the range is clamped', () => {
    const { rerender } = render(<ProgressBar label="התקדמות" value={250} valueText="הכול" />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('100%')

    rerender(<ProgressBar label="התקדמות" value={-5} valueText="כלום" />)
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%')
  })

  it.each([0, -10])('max of %d shows an empty bar and does not throw', (max) => {
    render(<ProgressBar label="התקדמות" value={30} max={max} valueText="אין משימות" />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuetext', 'אין משימות')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%')
  })
})

describe('ProgressBar without a visible label', () => {
  it('is named by aria-label, says the rounded percentage, and draws only the track', () => {
    render(<ProgressBar aria-label="התקדמות המבחן" value={2} max={5} />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות המבחן' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuetext', '40%')
    expect(bar).toHaveTextContent('')
    expect(bar.children).toHaveLength(1)
    expect(bar.firstElementChild).toHaveClass('h-1', 'bg-line')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('40%')
  })

  it('with a valueText and no label, shows the value alone at the end of the row', () => {
    render(<ProgressBar aria-label="התקדמות המבחן" value={2} max={5} valueText="2 מתוך 5" />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות המבחן' })
    expect(bar).toHaveAttribute('aria-valuetext', '2 מתוך 5')
    expect(within(bar).getByText('2 מתוך 5')).toHaveClass('ms-auto', 'tabular-nums')
    expect(bar.children).toHaveLength(2)
  })

  it('with a visible label and no valueText, shows the rounded percentage at the end of the row', () => {
    render(<ProgressBar label="התקדמות היום" value={60} max={345} />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות היום' })
    expect(bar).toHaveAttribute('aria-valuetext', '17%')
    expect(within(bar).getByText('17%')).toHaveClass('text-small', 'font-semibold', 'tabular-nums')
  })
})

describe('TextLink', () => {
  it('is a link in the brand colour, always underlined, that takes keyboard focus', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TextLink to="/exams" className="inline-flex min-h-touch items-center">
          לכל המבחנים
        </TextLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'לכל המבחנים' })
    expect(link).toHaveAttribute('href', '/exams')
    expect(link).toHaveClass('text-brand', 'underline', 'hover:text-brand-strong', 'min-h-touch')
    expect(link).toHaveClass('outline-none', 'focus-visible:ring-2', 'focus-visible:ring-brand')
    await user.tab()
    expect(link).toHaveFocus()
  })

  it('with `href` to another site it is a plain link that opens in a new tab', () => {
    render(<TextLink href="https://example.com/terms">תנאי השימוש</TextLink>)
    const link = screen.getByRole('link', { name: 'תנאי השימוש' })
    expect(link).toHaveAttribute('href', 'https://example.com/terms')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveClass('text-brand', 'underline', 'hover:text-brand-strong', 'focus-visible:ring-2')
  })

  it.each(['mailto:support@example.com', '/files/terms.pdf', '#top'])('with the href %s it stays in the same tab', (href) => {
    render(
      <TextLink href={href} className="text-small">
        קישור
      </TextLink>,
    )
    const link = screen.getByRole('link', { name: 'קישור' })
    expect(link).toHaveAttribute('href', href)
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
    expect(link).toHaveClass('text-small', 'underline')
  })
})
