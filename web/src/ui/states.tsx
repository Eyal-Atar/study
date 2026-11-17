import { CircleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { he } from '../i18n/he'
import { Button } from './Button'
import { cx, ICON_STROKE } from './styles'

// The three states every screen has besides its content: loading, empty and failed.

export interface SkeletonProps {
  // The size and the shape: "h-4 w-24", "size-6 rounded-full".
  className?: string
}

// One grey block in the place of content that has not arrived. The pulse is the "loading
// indicator" that section 7 of the design language allows to loop; the global
// prefers-reduced-motion rule stops it.
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx('block animate-pulse rounded-control bg-surface-muted', className)} />
}

export interface LoadingStateProps {
  // The shape of what will come: rows of a List, one Card, or lines of text.
  shape?: 'list' | 'card' | 'text'
  // How many rows (list) or lines (text). A card is always one.
  rows?: number
  // What a screen reader hears. Not shown.
  label?: string
}

// Lines of text end at different places; a block of equal lines reads as a table.
const LINE_WIDTHS = ['w-full', 'w-5/6', 'w-2/3', 'w-3/4'] as const

// Loading, in the shape of the content, so the screen does not jump when it arrives. Never a
// spinner over the whole screen. The label is for screen readers only (role="status" announces it
// politely); the drawing is hidden from them.
export function LoadingState({ shape = 'list', rows = 3, label = he.common.loading }: LoadingStateProps) {
  const indexes = Array.from({ length: Math.max(0, Math.floor(rows)) }, (_, index) => index)
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {shape === 'list'
          ? indexes.map((index) => (
              // The same box as a ListRow: 64px, a line under it.
              <div key={index} data-skeleton-row="" className="flex min-h-16 items-center gap-3 border-b border-line py-2">
                <Skeleton className="h-4 w-10 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="size-6 shrink-0 rounded-full" />
              </div>
            ))
          : null}
        {shape === 'card' ? (
          <div data-skeleton-card="" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-card">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}
        {shape === 'text' ? (
          <div className="flex max-w-prose flex-col gap-3">
            {indexes.map((index) => (
              <div key={index} data-skeleton-row="">
                <Skeleton className={cx('h-4', LINE_WIDTHS[index % LINE_WIDTHS.length])} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export interface EmptyStateProps {
  // Optional: a small empty place (a list inside a card) reads better with the words alone.
  icon?: LucideIcon | undefined
  // One sentence that says what is missing: "עוד אין מבחנים".
  title: string
  // What to do about it, when the title is not enough.
  description?: string
  // A Button, usually the primary one: an empty screen is where the first action starts.
  action?: ReactNode
}

// A list or a screen with nothing in it yet. It is ordinary content and not a message, so it has
// no role and is not announced.
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {Icon === undefined ? null : <Icon aria-hidden="true" size={28} strokeWidth={ICON_STROKE} className="text-ink-muted" />}
      <p className="text-body font-semibold break-words text-ink">{title}</p>
      {description === undefined ? null : <p className="max-w-prose text-small text-ink-muted">{description}</p>}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  )
}

export interface ErrorStateProps {
  message?: string
  // Given when trying again can help (a failed load). Without it there is no button.
  onRetry?: () => void
  retryLabel?: string
}

// Content that failed to load, in the place of the content. role="alert" announces it at once.
// The state is carried by the icon and the words, not by red text, and it is aligned to the start
// like the paragraph it replaces. For a failed action (a save) use a toast or the error of the
// field instead.
export function ErrorState({ message = he.errors.generic, onRetry, retryLabel = he.common.retry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <div className="flex items-start gap-2">
        {/* The margin centres the 18px icon on the first line of the message (a 23px line). */}
        <CircleAlert aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-danger" />
        <p className="min-w-0 text-body break-words text-ink">{message}</p>
      </div>
      {onRetry === undefined ? null : (
        <Button variant="secondary" onPress={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
