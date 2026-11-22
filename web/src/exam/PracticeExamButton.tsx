import { useId } from 'react'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { PracticeExamIcon } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'

const t = en.exams.exam.practice

// "Create a practice exam" belongs to S30. Until it exists the button is off, and "Coming soon" under it says
// why, so a disabled button is never a mystery: the text is also its description for a screen reader.
export function PracticeExamButton() {
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" isDisabled aria-describedby={hintId} className="w-full">
        <PracticeExamIcon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        {t.create}
      </Button>
      <p id={hintId} className="text-small text-ink-muted text-center">
        {t.soon}
      </p>
    </div>
  )
}
