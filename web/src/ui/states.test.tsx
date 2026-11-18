import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Inbox } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
import { Button } from './Button'
import { EmptyState, ErrorState, LoadingState, Skeleton } from './states'

function skeletonRows(root: HTMLElement) {
  return root.querySelectorAll('[data-skeleton-row]')
}

describe('Skeleton', () => {
  it('is a muted pulsing block that screen readers skip, in the size the caller gives', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />)
    const block = container.firstElementChild
    expect(block).toHaveAttribute('aria-hidden', 'true')
    expect(block).toHaveClass('block', 'rounded-control', 'bg-surface-muted', 'animate-pulse', 'h-4', 'w-24')
  })
})

describe('LoadingState', () => {
  it('is a status that says "טוען…" to screen readers only, over three list rows by default', () => {
    render(<LoadingState />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(he.common.loading)
    expect(status.textContent).toBe(he.common.loading)
    expect(screen.getByText(he.common.loading)).toHaveClass('sr-only')
    const rows = skeletonRows(status)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      // The same tile as a ListRow.
      expect(row).toHaveClass('min-h-16', 'rounded-[12px]', 'bg-canvas', 'mt-1.5', 'first:mt-0')
      expect(row).not.toHaveClass('border-b')
    }
    // Everything drawn is hidden from screen readers; only the label is read.
    const blocks = status.querySelectorAll('.animate-pulse')
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    // Never a full-screen spinner.
    expect(status.querySelector('.animate-spin')).toBeNull()
    expect(status.className).not.toMatch(/fixed|h-screen|min-h-screen/)
  })

  it.each([
    ['list', 5],
    ['text', 4],
    ['list', 1],
  ] as const)('the %s shape draws the %d rows it is asked for', (shape, rows) => {
    render(<LoadingState shape={shape} rows={rows} />)
    expect(skeletonRows(screen.getByRole('status'))).toHaveLength(rows)
  })

  it('the card shape is one lined card with a title line and two text lines', () => {
    render(<LoadingState shape="card" />)
    const status = screen.getByRole('status')
    const card = status.querySelector('[data-skeleton-card]')
    expect(card).toHaveClass('rounded-card', 'border', 'border-line', 'bg-surface', 'p-card')
    expect(card?.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(status.textContent).toBe(he.common.loading)
  })

  it('takes another label', () => {
    render(<LoadingState label="שומרים…" />)
    expect(screen.getByRole('status')).toHaveTextContent('שומרים…')
  })
})

describe('EmptyState', () => {
  it('shows the sentence, the description and an action that presses', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const { container } = render(
      <EmptyState icon={Inbox} title="עוד אין מבחנים" description="מוסיפים מבחן, ומקבלים לוח לימודים." action={<Button onPress={onPress}>הוספת מבחן</Button>} />,
    )
    expect(screen.getByText('עוד אין מבחנים')).toHaveClass('text-body', 'font-semibold', 'text-ink')
    expect(screen.getByText('מוסיפים מבחן, ומקבלים לוח לימודים.')).toHaveClass('text-small', 'text-ink-muted', 'max-w-prose')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The icon sits in a soft brand circle, like the avatar of the prototype.
    expect(container.querySelector('svg')?.parentElement).toHaveClass('rounded-full', 'bg-brand-soft', 'text-brand-strong')
    // Ordinary content: no live region.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'הוספת מבחן' }))
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('works with a title alone', () => {
    render(<EmptyState icon={Inbox} title="אין משימות להיום" />)
    expect(screen.getByText('אין משימות להיום')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws no icon when none is given', () => {
    const { container } = render(<EmptyState title="אין משימות להיום" description="אפשר לנוח." />)
    expect(screen.getByText('אין משימות להיום')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('ErrorState', () => {
  it('is an alert with the generic message and an icon, and no button without onRetry', () => {
    render(<ErrorState />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(he.errors.generic)
    expect(within(alert).getByText(he.errors.generic)).toHaveClass('text-body', 'text-ink')
    const icon = alert.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('text-danger')
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(alert.className).not.toMatch(/text-center|items-center/)
  })

  it('shows a custom message, and the retry button calls onRetry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState message={he.errors.unreachable} onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(he.errors.unreachable)
    expect(alert).not.toHaveTextContent(he.errors.generic)

    await user.click(within(alert).getByRole('button', { name: he.common.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('takes another retry label', () => {
    render(<ErrorState onRetry={vi.fn()} retryLabel="לטעון מחדש" />)
    expect(screen.getByRole('button', { name: 'לטעון מחדש' })).toBeInTheDocument()
  })
})
