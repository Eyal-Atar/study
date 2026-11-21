import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, type Me, type StudyWindow } from '../api/me'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { CheckboxCards } from '../ui/CheckboxCards'
import { Note } from '../ui/Note'
import { RadioCards } from '../ui/RadioCards'
import { ErrorState, LoadingState } from '../ui/states'
import { useUpdateMe } from './api'
import { OnboardingLayout } from './OnboardingLayout'
import { flushDeletes } from './pendingDeletes'
import { STEP_PATHS } from './steps'

const t = en.onboardingSchedule

// S13 decision 8: a choice of whole hours, not a free field. Faster on a phone, and inside the API's
// 30–960 minutes. The default is the profile's own (240), so an untouched answer changes nothing.
const HOURS = [1, 2, 3, 4, 5, 6, 8] as const
const DEFAULT_MINUTES = 240
const HOUR_OPTIONS = HOURS.map((hours) => ({ value: String(hours * 60), label: t.hours(hours) }))

const WINDOWS: readonly StudyWindow[] = ['morning', 'afternoon', 'evening', 'night']
const WINDOW_OPTIONS = WINDOWS.map((window) => ({
  value: window,
  label: t.windows[window].label,
  description: t.windows[window].range,
}))

function isWindow(value: string): value is StudyWindow {
  return (WINDOWS as readonly string[]).includes(value)
}

function initialMinutes(me: Me): string {
  return HOURS.some((hours) => hours * 60 === me.daily_study_minutes) ? String(me.daily_study_minutes) : String(DEFAULT_MINUTES)
}

// Onboarding step 3: the two questions of spec 7.9 (how many hours a day, and when). Wake and sleep
// times are not asked; the profile's 08:00–23:00 stays (S13 decisions 8–9).
export function ScheduleStep() {
  const me = useMe()

  if (me.isPending) {
    return (
      <OnboardingLayout step={3} title={t.title}>
        <LoadingState shape="card" />
      </OnboardingLayout>
    )
  }
  if (me.isError) {
    return (
      <OnboardingLayout step={3} title={t.title}>
        <ErrorState
          message={errorMessage(me.error)}
          onRetry={() => {
            void me.refetch()
          }}
        />
      </OnboardingLayout>
    )
  }
  // The form starts from the profile once it is loaded.
  return <ScheduleForm me={me.data} />
}

function ScheduleForm({ me }: { me: Me }) {
  const navigate = useNavigate()
  const updateMe = useUpdateMe()
  const errorId = useId()
  const [minutes, setMinutes] = useState(() => initialMinutes(me))
  const [windows, setWindows] = useState<StudyWindow[]>(() => me.study_windows.filter(isWindow))
  const [missingWindow, setMissingWindow] = useState(false)

  function build() {
    if (windows.length === 0) {
      setMissingWindow(true)
      return
    }
    updateMe
      .mutateAsync({ daily_study_minutes: Number(minutes), study_windows: windows })
      // Material deletes sent when the materials step went away may still be on their way; the plan
      // must not be built while the deleted files still exist.
      .then(() => flushDeletes())
      .then(() => navigate(STEP_PATHS.building))
      .catch(() => {
        // The error is shown from updateMe.error.
      })
  }

  const actions = (
    <>
      {/* The button says what it starts, and keeps saying it while the answers are saved. */}
      <Button className="flex-1 md:flex-none" isPending={updateMe.isPending} onPress={build}>
        {t.build}
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          void navigate(STEP_PATHS.materials)
        }}
      >
        {en.common.back}
      </Button>
    </>
  )

  return (
    <OnboardingLayout step={3} title={t.title} intro={t.intro} actions={actions}>
      <RadioCards
        label={t.hoursQuestion}
        options={HOUR_OPTIONS}
        value={minutes}
        onChange={setMinutes}
        columns="grid-cols-4"
      />
      <div className="flex flex-col gap-2">
        <CheckboxCards
          label={t.windowsQuestion}
          description={t.windowsHint}
          options={WINDOW_OPTIONS}
          value={windows}
          onChange={(value) => {
            setWindows(value.filter(isWindow))
            if (value.length > 0) setMissingWindow(false)
          }}
          {...(missingWindow ? { errorId } : {})}
        />
        {missingWindow ? (
          <p id={errorId} role="alert" className="text-small text-danger">
            {t.windowsRequired}
          </p>
        ) : null}
        {windows.includes('night') ? <Note>{t.nightNote}</Note> : null}
      </div>
      {updateMe.isError ? (
        <p role="alert" className="text-small text-danger">
          {errorMessage(updateMe.error)}
        </p>
      ) : null}
    </OnboardingLayout>
  )
}
