import { useNavigate } from 'react-router'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_PATHS } from './steps'

const t = en.onboardingFlow.fixedHours

// Onboarding step 4 of 4 (S34 decision 4): the hours that are already taken. For now only the
// frame: Archi's question, and the button that starts the build. Task 15 of S34 replaces this
// file with the two answers, the small week and the photo of the timetable.
export function FixedHoursStep() {
  const navigate = useNavigate()
  return (
    <OnboardingLayout
      step={4}
      mood="flow"
      question={t.question}
      below={t.below}
      bare
      primary={
        <Button
          className="flex-1 md:flex-none"
          onPress={() => {
            void navigate(STEP_PATHS.building)
          }}
        >
          {en.onboardingSchedule.build}
        </Button>
      }
    >
      {null}
    </OnboardingLayout>
  )
}
