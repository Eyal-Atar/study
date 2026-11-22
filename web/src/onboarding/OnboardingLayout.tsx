import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { ArchieMood } from '../archie/Archie'
import { en } from '../i18n/en'
import { ArchiLead } from '../ui/ArchiLead'
import { Card } from '../ui/Card'
import { IconButton } from '../ui/IconButton'
import { ChevronLeft } from '../ui/icons'
import { RecapLine, type RecapLineProps } from '../ui/RecapLine'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { cx, ICON_STROKE } from '../ui/styles'
import { STEP_COUNT, STEP_PATHS } from './steps'

export interface OnboardingLayoutProps {
  step: 1 | 2 | 3 | 4
  // Archi at this step, and what he asks. The question is the h1 of the screen.
  mood: ArchieMood
  question: string
  // One sentence of his beside him, under the question.
  context?: string | undefined
  // One paragraph under him, at the full width, for a longer explanation.
  below?: string | undefined
  // The answer of an earlier step, as one quiet line ("3 exams: ..."). The user's words go in
  // `value`, as they are.
  recap?: RecapLineProps | undefined
  // The controls that answer him.
  children: ReactNode
  // The one button the step exists for. On phones it sits in a bar pinned to the bottom, within
  // thumb reach, and grows; from md up it follows the content.
  primary: ReactNode
  secondary?: ReactNode
  // The step lays out its own controls. Without it they sit on one card, the card Archi stands
  // behind (the .answer of the prototype).
  bare?: boolean | undefined
  // What "Back" does, for a step with something to finish before it is left. Without it "Back"
  // goes to the step before. null: this screen has no "Back".
  onBack?: (() => void) | null | undefined
}

// Where "Back" leads from each step. The first step has nowhere to go back to.
const PREVIOUS = {
  1: null,
  2: STEP_PATHS.exams,
  3: STEP_PATHS.materials,
  4: STEP_PATHS.schedule,
} as const

// A new step comes in (S34 decision 23): the answers fade in over 180ms while rising 8px, from
// the first frame they are on the page (starting:). A browser without @starting-style shows
// them at once, which is the calm fallback.
const ENTRANCE =
  'motion-safe:transition-[opacity,translate] motion-safe:duration-180 motion-safe:ease-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-2'

// The frame of every onboarding step, as a conversation that Archi leads (audit, guidelines 7 and
// 8): one row that says where the student is and lets them go back, then Archi and his question,
// and under him only what answers it. The bottom holds the one way forward.
// The width and the side margins are the shell's <main>.
//
// The question is on the page at once and never moves: only what is under Archi enters, and never
// for someone who asked the system for less motion.
export function OnboardingLayout({
  step,
  mood,
  question,
  context,
  below,
  recap,
  children,
  primary,
  secondary,
  bare = false,
  onBack,
}: OnboardingLayoutProps) {
  const navigate = useNavigate()
  const [enters] = useState(() => !prefersReducedMotion())

  // The question names the browser tab (WCAG 2.4.2), as a PageHeader does on the other screens,
  // and the plain name comes back when the step leaves.
  useEffect(() => {
    document.title = `${question} – ${en.appName}`
    return () => {
      document.title = en.appName
    }
  }, [question])

  const previous = PREVIOUS[step]
  const back = onBack === null ? null : (onBack ?? (previous === null ? null : () => void navigate(previous)))
  const hasActions = (primary !== undefined && primary !== null) || (secondary !== undefined && secondary !== null)

  return (
    <div className="flex flex-col gap-3">
      {/* The .steps of the prototype: back, the four segments, and the count, in one row. */}
      <div className="flex min-h-touch items-center gap-2.5">
        {back === null ? null : (
          <IconButton variant="secondary" aria-label={en.common.back} onPress={back}>
            <ChevronLeft aria-hidden="true" size={20} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        {/* The steps bar is the onboarding's own: four thin segments, the done and the current in
            brand ("you are here"), the rest in the colour of a line. */}
        <nav aria-label={en.onboarding.stepsLabel} className="min-w-0 flex-1">
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
        <p className="shrink-0 text-small text-ink-muted tabular-nums">{en.onboarding.stepOf(step, STEP_COUNT)}</p>
      </div>

      <div>
        {/* He brings no space under him: what comes next is the ground under his feet. */}
        <ArchiLead mood={mood} question={question} context={context} below={below} />
        <div data-part="answer" data-entering={enters ? '' : undefined} className={enters ? ENTRANCE : undefined}>
          {recap === undefined ? null : (
            <div className="mb-2">
              <RecapLine {...recap} />
            </div>
          )}
          {bare ? <div className="flex flex-col gap-6">{children}</div> : <Card>{children}</Card>}
        </div>
      </div>

      {hasActions ? (
        // The shell's <main> keeps room under the content for this bar and for the home indicator.
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-page pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:static md:z-auto md:mt-3 md:border-t-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0">
          <div className="flex items-center gap-2">
            {primary}
            {secondary}
          </div>
        </div>
      ) : null}
    </div>
  )
}
