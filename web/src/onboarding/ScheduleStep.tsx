import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, type StudyWindow } from '../api/me'
import { useCommitments } from '../availability/api'
import { todayIn } from '../exam/dates'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { DAYPART_ICON } from '../ui/icons'
import { IconChoiceCards } from '../ui/IconChoiceCards'
import { Note } from '../ui/Note'
import { ErrorState, LoadingState } from '../ui/states'
import { Stepper } from '../ui/Stepper'
import { useExams, useUpdateMe } from './api'
import { feasibility } from './feasibility'
import { FeasibilityNote } from './FeasibilityNote'
import { markedRanges, useMarkedCells } from './markedHours'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_PATHS } from './steps'

const t = en.onboardingSchedule

// S13 decision 8: a choice of whole hours, not a free field. Faster on a phone, and inside the API's
// 30–960 minutes. The default is the profile's own (240), so an untouched answer changes nothing.
const HOURS = [1, 2, 3, 4, 5, 6, 8] as const
const DEFAULT_MINUTES = 240
const HOUR_OPTIONS = HOURS.map((hours) => ({ value: hours * 60, label: t.hours(hours) }))

const WINDOWS: readonly StudyWindow[] = ['morning', 'afternoon', 'evening', 'night']
// Each time of day carries its icon (audit section 2: designed sun and moon icons, never emoji).
const WINDOW_OPTIONS = WINDOWS.map((window) => ({
  value: window,
  label: t.windows[window].label,
  description: t.windows[window].range,
  icon: DAYPART_ICON[window],
}))

function isWindow(value: string): value is StudyWindow {
  return (WINDOWS as readonly string[]).includes(value)
}

// Onboarding step 3: the two questions of spec 7.9 (how many hours a day, and when). Wake and sleep
// times are not asked; the profile's 08:00–23:00 stays (S13 decisions 8–9).
//
// The layout is rendered once, from here, and only its children change while the profile loads: a
// layout that was swapped for another would mount again and replay its entrance.
export function ScheduleStep() {
  const navigate = useNavigate()
  const me = useMe()
  const exams = useExams()
  const commitments = useCommitments()
  const marked = useMarkedCells()
  const updateMe = useUpdateMe()
  const errorId = useId()
  // What the student has chosen so far. Until they choose, the profile's own answer stands, so the
  // state needs no copy of the profile and no effect.
  const [chosenMinutes, setChosenMinutes] = useState<number | null>(null)
  const [chosenWindows, setChosenWindows] = useState<StudyWindow[] | null>(null)
  const [missingWindow, setMissingWindow] = useState(false)

  const profile = me.data
  const minutes =
    chosenMinutes ??
    (profile !== undefined && HOURS.some((hours) => hours * 60 === profile.daily_study_minutes)
      ? profile.daily_study_minutes
      : DEFAULT_MINUTES)
  const windows = chosenWindows ?? (profile === undefined ? [] : profile.study_windows.filter(isWindow))

  // What I make of the exams from the values being chosen right now, so it answers every press.
  // Null without exams or a profile, and while no exam has a complete date.
  // Null too while no window is chosen: the issue then is the missing window, not a lack of time.
  // The busy time counts as in step 4 (decision 7): the saved busy times and the hours marked there
  // and not saved yet, so the note says the same here as there. Null until they load.
  const saved = commitments.data
  const estimate =
    profile === undefined || exams.data === undefined || saved === undefined || windows.length === 0
      ? null
      : feasibility({
          today: todayIn(profile.timezone),
          exams: exams.data.map((exam) => ({ name: exam.name, exam_date: exam.exam_date })),
          profile: { ...profile, daily_study_minutes: minutes, study_windows: windows },
          busy: [...saved, ...markedRanges(marked, profile)],
        })

  function save() {
    if (windows.length === 0) {
      setMissingWindow(true)
      return
    }
    updateMe
      .mutateAsync({ daily_study_minutes: minutes, study_windows: windows })
      .then(() => navigate(STEP_PATHS.fixedHours))
      .catch(() => {
        // The error is shown from updateMe.error.
      })
  }

  // isPending keeps the text and ignores presses, so a double press saves once. "Back" is at the
  // top of the layout.
  const primary =
    profile === undefined ? null : (
      <Button className="flex-1 md:flex-none" isPending={updateMe.isPending} onPress={save}>
        {en.onboarding.continue}
      </Button>
    )

  return (
    <OnboardingLayout
      step={3}
      mood="intentions"
      question={t.hoursQuestion}
      context={t.intro}
      primary={primary}
      bare
    >
      {me.isPending ? (
        <LoadingState shape="card" />
      ) : profile === undefined ? (
        <ErrorState
          message={errorMessage(me.error)}
          onRetry={() => {
            void me.refetch()
          }}
        />
      ) : (
        <>
          <Card>
            <Stepper
              label={en.onboardingFlow.schedule.hoursLabel}
              value={minutes}
              options={HOUR_OPTIONS}
              onChange={setChosenMinutes}
            />
            <FeasibilityNote estimate={estimate} />
          </Card>
          <div className="flex flex-col gap-2">
            <IconChoiceCards
              label={t.windowsQuestion}
              description={t.windowsHint}
              options={WINDOW_OPTIONS}
              value={windows}
              onChange={(value) => {
                setChosenWindows(value.filter(isWindow))
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
        </>
      )}
    </OnboardingLayout>
  )
}
