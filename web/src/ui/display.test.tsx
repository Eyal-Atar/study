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
      <Card role="region" aria-label="Next task" id="next" className="mt-4">
        Practice תוחלת
      </Card>,
    )
    const card = screen.getByRole('region', { name: 'Next task' })
    expect(card).toHaveTextContent('Practice תוחלת')
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
      <Card tone={tone} role="group" aria-label="Status">
        Content
      </Card>,
    )
    const card = screen.getByRole('group', { name: 'Status' })
    expect(card).toHaveClass(border, background, 'text-ink')
    expect(card).not.toHaveClass('border-line', 'bg-surface')
    expect(card.className).not.toMatch(/shadow/)
  })

  it('without a title it has no heading and no aria-labelledby', () => {
    render(<Card role="group">Content</Card>)
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
      <Card tone={tone} title="The file could not be read">
        <p>You can upload it again.</p>
      </Card>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'The file could not be read' })
    expect(heading).toHaveClass('text-body', 'font-semibold', 'mb-2', colour)
    const card = heading.parentElement as HTMLElement
    expect(card.firstElementChild).toBe(heading)
    expect(card).toHaveTextContent('You can upload it again.')
    // Without a role an accessible name would be ignored, so none is set.
    expect(card).not.toHaveAttribute('aria-labelledby')
  })

  it('titleLevel makes the heading an h3', () => {
    render(<Card title="Your plan is ready" titleLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Your plan is ready' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('a card with a role is named by its title, unless the caller names it', () => {
    render(
      <>
        <Card role="region" title="Next task">
          Content
        </Card>
        <Card role="group" aria-label="Name אחר" title="Title">
          Content
        </Card>
      </>,
    )
    expect(screen.getByRole('region', { name: 'Next task' })).toContainElement(screen.getByRole('heading', { name: 'Next task' }))
    expect(screen.getByRole('group', { name: 'Name אחר' })).not.toHaveAttribute('aria-labelledby')
  })
})

describe('SectionHeading', () => {
  it('is an h2 that reads as a label: small, medium, muted', () => {
    render(<SectionHeading id="today">Later today</SectionHeading>)
    const heading = screen.getByRole('heading', { level: 2, name: 'Later today' })
    expect(heading).toHaveAttribute('id', 'today')
    expect(heading).toHaveClass('text-small', 'font-medium', 'text-ink-muted')
    expect(heading).not.toHaveClass('font-semibold')
  })

  it('level 3 is an h3, and it takes a class', () => {
    render(
      <SectionHeading level={3} className="mb-2">
        Files
      </SectionHeading>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Files' })).toHaveClass('text-small', 'mb-2')
  })
})

describe('List', () => {
  it('is a named list of rows with a title and a subtitle, each a soft canvas tile like the task of the prototype', () => {
    render(
      <List aria-label="Later today">
        <ListRow leading="10:00" title="Practice תוחלת" subtitle="Probability, practice. 1 h" />
        <ListRow title="סיכום פרק 3" />
      </List>,
    )
    const list = screen.getByRole('list', { name: 'Later today' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const first = rows[0] as HTMLElement
    expect(first).toHaveTextContent('10:00')
    expect(within(first).getByText('Practice תוחלת')).toHaveClass('text-body', 'font-semibold', 'text-ink')
    expect(within(first).getByText('Probability, practice. 1 h')).toHaveClass('text-small', 'text-ink-muted')
    expect(within(first).getByText('10:00')).toHaveClass('tabular-nums', 'shrink-0')
    for (const row of rows) {
      // 6px apart (the first has no margin), no line between them, no card and no shadow.
      expect(row).toHaveClass('min-h-16', 'rounded-[12px]', 'bg-canvas', 'mt-1.5', 'first:mt-0')
      expect(row.className).not.toMatch(/border-b|rounded-card|bg-surface(\s|$)|shadow/)
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
                  subtitle="In 12 days"
                  trailing={
                    <Button variant="secondary" onPress={onPress}>
                      Actions
                    </Button>
                  }
                />
              </List>
            }
          />
          <Route path="/exams/e1" element={<p>Exam page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const row = screen.getByRole('listitem')
    const link = within(row).getByRole('link', { name: 'חדו״א 1' })
    expect(link).toHaveAttribute('href', '/exams/e1')
    // The link is stretched over the whole row, and the control sits above it.
    expect(row).toHaveClass('relative', 'hover:bg-surface-muted')
    expect(link).toHaveClass('after:absolute', 'after:inset-0', 'outline-none', 'focus-visible:after:ring-2', 'focus-visible:after:ring-brand')
    const button = within(row).getByRole('button', { name: 'Actions' })
    expect(button.parentElement).toHaveClass('relative', 'z-10', 'shrink-0', 'flex', 'items-center', 'gap-2', 'min-w-0', 'max-w-[50%]')

    await user.click(button)
    expect(onPress).toHaveBeenCalledOnce()
    expect(screen.queryByText('Exam page')).not.toBeInTheDocument()

    await user.click(link)
    expect(screen.getByText('Exam page')).toBeInTheDocument()
  })

  it('the link of a row takes keyboard focus before the control at its end', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <List>
          <ListRow to="/exams/e1" title="חדו״א 1" trailing={<Button variant="secondary">Actions</Button>} />
        </List>
      </MemoryRouter>,
    )
    await user.tab()
    expect(screen.getByRole('link', { name: 'חדו״א 1' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus()
  })

  it('a row with `onPress` is a button named by the title, stretched over the row like the link', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const onTrailing = vi.fn()
    render(
      <List>
        <ListRow
          onPress={onPress}
          title="Practice תוחלת"
          subtitle="הסתברות"
          trailing={
            <Button variant="secondary" onPress={onTrailing}>
              Actions
            </Button>
          }
        />
      </List>,
    )
    const row = screen.getByRole('listitem')
    const title = within(row).getByRole('button', { name: 'Practice תוחלת' })
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

    await user.click(within(row).getByRole('button', { name: 'Actions' }))
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
    const long = 'A very long badge '.repeat(8).trim()
    render(
      <List>
        <ListRow
          title="Practice תוחלת"
          trailing={
            <>
              <Badge tone="warning">{long}</Badge>
              <Button variant="secondary">Actions</Button>
            </>
          }
        />
      </List>,
    )
    const badge = screen.getByText(long)
    expect(badge).toHaveClass('truncate', 'max-w-full')
    expect(badge.parentElement).toHaveClass('flex', 'min-w-0', 'max-w-[50%]', 'shrink-0', 'items-center', 'gap-2')
    expect(badge.parentElement).toContainElement(screen.getByRole('button', { name: 'Actions' }))
  })

  it('a done row strikes its title through in the muted colour and the normal weight', () => {
    render(
      <MemoryRouter>
        <List>
          <ListRow done title="Practice תוחלת" />
          <ListRow done to="/tasks/t1" title="סיכום פרק 3" />
        </List>
      </MemoryRouter>,
    )
    for (const title of [screen.getByText('Practice תוחלת'), screen.getByRole('link', { name: 'סיכום פרק 3' })]) {
      expect(title).toHaveClass('line-through', 'text-ink-muted', 'font-normal')
      expect(title).not.toHaveClass('font-semibold', 'text-ink')
    }
  })

  it('a long title without spaces wraps inside the row instead of widening the page', () => {
    const long = 'א'.repeat(60)
    render(
      <List>
        <ListRow leading="10:00" title={long} trailing={<Button variant="secondary">Actions</Button>} />
      </List>,
    )
    const title = screen.getByText(long)
    expect(title).toHaveClass('break-words')
    expect(title.parentElement).toHaveClass('min-w-0', 'flex-1')
  })
})

describe('Badge', () => {
  it.each([
    ['brand', 'Now', 'bg-brand-soft', 'text-brand-strong'],
    ['success', 'Done', 'bg-success-soft', 'text-success'],
    ['warning', 'Overdue', 'bg-warning-soft', 'text-warning'],
    ['neutral', 'Skipped', 'bg-surface-muted', 'text-ink-muted'],
  ] as const)('a %s badge shows its text on the soft colour of its state', (tone, text, background, colour) => {
    render(<Badge tone={tone}>{text}</Badge>)
    const badge = screen.getByText(text)
    expect(badge.tagName).toBe('SPAN')
    // A pill with a medium label.
    expect(badge).toHaveClass('rounded-full', 'px-2.5', 'text-small', 'font-medium', background, colour)
  })

  it('a long badge stays on one line and is cut with an ellipsis at the width of its container', () => {
    const long = 'Waiting for the lecturer to confirm a new date '.repeat(4).trim()
    render(<Badge tone="neutral">{long}</Badge>)
    const badge = screen.getByText(long)
    // truncate: overflow hidden, an ellipsis, and no wrapping. max-w-full needs a block box.
    expect(badge).toHaveClass('inline-block', 'max-w-full', 'truncate', 'align-middle')
    expect(badge).not.toHaveClass('inline-flex')
  })
})

describe('ProgressBar', () => {
  it('is a progressbar named by its label, and says its value in words', () => {
    render(<ProgressBar label="Progress for today" value={60} max={345} valueText="60 of 345 minutes" />)
    const bar = screen.getByRole('progressbar', { name: 'Progress for today' })
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect(bar).toHaveAttribute('aria-valuemax', '345')
    expect(bar).toHaveAttribute('aria-valuetext', '60 of 345 minutes')
    expect(within(bar).getByText('Progress for today')).toHaveClass('text-small', 'text-ink-muted')
    expect(within(bar).getByText('60 of 345 minutes')).toHaveClass('text-small', 'font-medium', 'tabular-nums')
    const fill = bar.querySelector('[data-fill]')
    expect(fill).toHaveClass('bg-success', 'rounded-full')
    // The 6px rounded bar of the prototype's exams, on the surface-muted track.
    expect(fill?.parentElement).toHaveClass('h-1.5', 'rounded-full', 'bg-surface-muted')
    expect((fill as HTMLElement).style.width).toMatch(/^17\.39/)
  })

  it('max defaults to 100, and a value outside the range is clamped', () => {
    const { rerender } = render(<ProgressBar label="Progress" value={250} valueText="All" />)
    const bar = screen.getByRole('progressbar', { name: 'Progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('100%')

    rerender(<ProgressBar label="Progress" value={-5} valueText="None" />)
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%')
  })

  it.each([0, -10])('max of %d shows an empty bar and does not throw', (max) => {
    render(<ProgressBar label="Progress" value={30} max={max} valueText="No tasks" />)
    const bar = screen.getByRole('progressbar', { name: 'Progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuetext', 'No tasks')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%')
  })
})

describe('ProgressBar without a visible label', () => {
  it('is named by aria-label, says the rounded percentage, and draws only the track', () => {
    render(<ProgressBar aria-label="Exam progress" value={2} max={5} />)
    const bar = screen.getByRole('progressbar', { name: 'Exam progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuetext', '40%')
    expect(bar).toHaveTextContent('')
    expect(bar.children).toHaveLength(1)
    expect(bar.firstElementChild).toHaveClass('h-1.5', 'bg-surface-muted')
    expect((bar.querySelector('[data-fill]') as HTMLElement).style.width).toBe('40%')
  })

  it('with a valueText and no label, shows the value alone at the end of the row', () => {
    render(<ProgressBar aria-label="Exam progress" value={2} max={5} valueText="2 of 5" />)
    const bar = screen.getByRole('progressbar', { name: 'Exam progress' })
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 5')
    expect(within(bar).getByText('2 of 5')).toHaveClass('ms-auto', 'tabular-nums')
    expect(bar.children).toHaveLength(2)
  })

  it('with a visible label and no valueText, shows the rounded percentage at the end of the row', () => {
    render(<ProgressBar label="Progress for today" value={60} max={345} />)
    const bar = screen.getByRole('progressbar', { name: 'Progress for today' })
    expect(bar).toHaveAttribute('aria-valuetext', '17%')
    expect(within(bar).getByText('17%')).toHaveClass('text-small', 'font-medium', 'tabular-nums')
  })
})

describe('TextLink', () => {
  it('is a link in the green of text, always underlined, that takes keyboard focus', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TextLink to="/exams" className="inline-flex min-h-touch items-center">
          All exams
        </TextLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'All exams' })
    expect(link).toHaveAttribute('href', '/exams')
    expect(link).toHaveClass('text-brand-strong', 'underline', 'hover:text-brand-strong', 'min-h-touch')
    expect(link).toHaveClass('outline-none', 'focus-visible:ring-2', 'focus-visible:ring-brand')
    await user.tab()
    expect(link).toHaveFocus()
  })

  it('with `href` to another site it is a plain link that opens in a new tab', () => {
    render(<TextLink href="https://example.com/terms">Terms of use</TextLink>)
    const link = screen.getByRole('link', { name: 'Terms of use' })
    expect(link).toHaveAttribute('href', 'https://example.com/terms')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveClass('text-brand-strong', 'underline', 'hover:text-brand-strong', 'focus-visible:ring-2')
  })

  it.each(['mailto:support@example.com', '/files/terms.pdf', '#top'])('with the href %s it stays in the same tab', (href) => {
    render(
      <TextLink href={href} className="text-small">
        Link
      </TextLink>,
    )
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link).toHaveAttribute('href', href)
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
    expect(link).toHaveClass('text-small', 'underline')
  })
})
