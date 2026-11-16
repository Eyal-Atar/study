import type { ReactNode } from 'react'
import { he } from '../i18n/he'
import { STEP_COUNT } from './steps'

export interface OnboardingLayoutProps {
  step: 1 | 2 | 3 | 4
  title: string
  intro?: string
  children: ReactNode
  // The step's buttons (back, next). On phones they sit in a bar pinned to the bottom, within thumb
  // reach; from md up they follow the content.
  actions?: ReactNode
}

// The frame of every onboarding step: where the student is (step n of 4), the title, and the actions.
export function OnboardingLayout({ step, title, intro, children, actions }: OnboardingLayoutProps) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">{he.onboarding.stepOf(step, STEP_COUNT)}</p>
        <nav aria-label={he.onboarding.stepsLabel}>
          <ol className="flex gap-1.5">
            {he.onboarding.steps.map((name, index) => (
              <li
                key={name}
                aria-current={index + 1 === step ? 'step' : undefined}
                className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-brand' : 'bg-line'}`}
              >
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {intro === undefined ? null : <p className="text-ink-muted">{intro}</p>}
      </div>

      {children}

      {actions === undefined ? null : (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
          <div className="mx-auto flex max-w-xl items-center justify-end gap-3">{actions}</div>
        </div>
      )}
    </div>
  )
}
