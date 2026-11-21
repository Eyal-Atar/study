import type { ReactNode } from 'react'
import { en } from '../i18n/en'
import { PageHeader } from '../ui/PageHeader'
import { cx } from '../ui/styles'
import { STEP_COUNT } from './steps'

export interface OnboardingLayoutProps {
  step: 1 | 2 | 3 | 4
  title: string
  intro?: string
  children: ReactNode
  // The step's buttons: the primary one first (it grows on a phone), then "Back". On phones they
  // sit in a bar pinned to the bottom, within thumb reach; from md up they follow the content.
  actions?: ReactNode
}

// The frame of every onboarding step: where the student is (step n of 4), the one question of the
// step as the title, and the actions. The width and the side margins are the shell's <main>, so
// the title lines up with the name in the top row, like on every other screen.
export function OnboardingLayout({ step, title, intro, children, actions }: OnboardingLayoutProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-small text-ink-muted tabular-nums">{en.onboarding.stepOf(step, STEP_COUNT)}</p>
        {/* The steps bar is the onboarding's own: four thin segments, the done and the current in
            brand ("you are here"), the rest in the colour of a line. */}
        <nav aria-label={en.onboarding.stepsLabel}>
          <ol className="flex gap-1">
            {en.onboarding.steps.map((name, index) => (
              <li
                key={name}
                aria-current={index + 1 === step ? 'step' : undefined}
                className={cx('h-1 flex-1 rounded-full', index < step ? 'bg-brand' : 'bg-line')}
              >
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <div className="flex flex-col gap-2">
        <PageHeader title={title} />
        {intro === undefined ? null : <p className="max-w-prose text-body text-ink-muted">{intro}</p>}
      </div>

      {children}

      {actions === undefined ? null : (
        // The shell's <main> keeps room under the content for this bar and for the home indicator.
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-page pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:static md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0">
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
    </div>
  )
}
