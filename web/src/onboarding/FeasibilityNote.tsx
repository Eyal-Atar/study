import { en } from '../i18n/en'
import { CircleAlert, XpSparkIcon, type IconType } from '../ui/icons'
import { Note } from '../ui/Note'
import { ICON_STROKE } from '../ui/styles'

// What the estimate of onboarding/feasibility.ts says. Defined here for now: Task 10 of S34 moves
// it there, with the function that computes it.
export interface FeasibilityEstimate {
  level: 'none' | 'tight' | 'roomy'
  firstExamName: string
  firstExamMinutes: number
  // The exam where the time runs short (tight) or out (none), when it is not the first one.
  tightExamName?: string
  tightExamMinutes?: number
}

// roomy is good news in a neutral note. tight and none need attention and are not a failure, so
// they are a warning, never a danger. The icon's colour is one of the checked pairs of its fill.
const LOOKS: Record<FeasibilityEstimate['level'], { tone: 'neutral' | 'warning'; icon: IconType; color: string }> = {
  roomy: { tone: 'neutral', icon: XpSparkIcon, color: 'text-brand-strong' },
  tight: { tone: 'warning', icon: CircleAlert, color: 'text-warning' },
  none: { tone: 'warning', icon: CircleAlert, color: 'text-warning' },
}

function sentence(estimate: FeasibilityEstimate): string {
  const t = en.onboardingFlow.feasibility
  const examName = estimate.tightExamName ?? estimate.firstExamName
  switch (estimate.level) {
    case 'roomy':
      return t.roomy(estimate.firstExamMinutes, estimate.firstExamName)
    case 'tight':
      return t.tight(estimate.tightExamMinutes ?? estimate.firstExamMinutes, examName)
    case 'none':
      return t.none(examName)
  }
}

// Archi's live answer while the student fills in exams and hours (audit, guideline 9). The live
// region is on the page from the start and stays the same element, empty without an estimate: a
// screen reader announces a sentence that changes inside it, and would miss a region that
// arrives together with its text.
export function FeasibilityNote({ estimate }: { estimate: FeasibilityEstimate | null }) {
  const look = estimate === null ? null : LOOKS[estimate.level]
  return (
    <div role="status" aria-live="polite">
      {estimate === null || look === null ? null : (
        <Note tone={look.tone}>
          <span className="flex items-start gap-2">
            <look.icon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className={`mt-0.5 shrink-0 ${look.color}`} />
            <span className="min-w-0">{sentence(estimate)}</span>
          </span>
        </Note>
      )}
    </div>
  )
}
