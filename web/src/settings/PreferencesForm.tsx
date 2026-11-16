import { useId, useState } from 'react'
import { SwitchButton, SwitchField } from 'react-aria-components'
import { ApiError, errorMessage } from '../api/client'
import type { Me, MePatch, StudyWindow } from '../api/me'
import { he } from '../i18n/he'
import { useUpdateMe } from '../onboarding/api'
import { useReplanOffer } from '../plan/replanOfferContext'
import { Button } from '../ui/Button'
import { CheckboxCards } from '../ui/CheckboxCards'
import { RadioCards, type ChoiceOption } from '../ui/RadioCards'
import { useToast } from '../ui/useToast'

const t = he.settings.preferences

// The same whole hours as the onboarding (S13 decision 8).
const HOURS = [1, 2, 3, 4, 5, 6, 8] as const
const HOUR_MINUTES = HOURS.map((hours) => hours * 60)
const DELAYS = [0, 15, 30, 45, 60, 90, 120] as const
const HOBBY_LENGTHS = [30, 45, 60, 90, 120] as const
const REST_DAYS = [0, 1, 2, 3] as const
// What the hobby starts with when it is switched on for the first time.
const HOBBY_DEFAULT_START = '18:00'
const HOBBY_DEFAULT_MINUTES = 60

const WINDOWS: readonly StudyWindow[] = ['morning', 'afternoon', 'evening', 'night']
const WINDOW_OPTIONS = WINDOWS.map((window) => ({
  value: window,
  label: he.onboardingSchedule.windows[window].label,
  description: he.onboardingSchedule.windows[window].range,
}))

type Field =
  | 'daily_study_minutes'
  | 'study_windows'
  | 'wake_time'
  | 'sleep_time'
  | 'study_start_delay_minutes'
  | 'hobby_start'
  | 'hobby_minutes'
  | 'rest_days_before_exam'

const FIELDS: readonly Field[] = [
  'daily_study_minutes',
  'study_windows',
  'wake_time',
  'sleep_time',
  'study_start_delay_minutes',
  'hobby_start',
  'hobby_minutes',
  'rest_days_before_exam',
]

type FieldErrors = Partial<Record<Field, string>>

interface Values {
  minutes: number
  windows: StudyWindow[]
  wake: string
  sleep: string
  delay: number
  hobbyOn: boolean
  hobbyStart: string
  hobbyMinutes: number
  rest: number
}

function isWindow(value: string): value is StudyWindow {
  return (WINDOWS as readonly string[]).includes(value)
}

function fromMe(me: Me): Values {
  return {
    minutes: me.daily_study_minutes,
    windows: me.study_windows.filter(isWindow),
    wake: me.wake_time,
    sleep: me.sleep_time,
    delay: me.study_start_delay_minutes,
    hobbyOn: me.hobby_start !== null && me.hobby_minutes !== null,
    hobbyStart: me.hobby_start ?? HOBBY_DEFAULT_START,
    hobbyMinutes: me.hobby_minutes ?? HOBBY_DEFAULT_MINUTES,
    rest: me.rest_days_before_exam,
  }
}

function sameWindows(a: readonly StudyWindow[], b: readonly StudyWindow[]): boolean {
  return a.length === b.length && a.every((w) => b.includes(w))
}

// Only what differs from the profile. The hobby is one pair: both fields or neither (S15 contract).
function changes(me: Me, values: Values): MePatch {
  const patch: MePatch = {}
  if (values.minutes !== me.daily_study_minutes) patch.daily_study_minutes = values.minutes
  if (!sameWindows(values.windows, me.study_windows)) {
    patch.study_windows = WINDOWS.filter((w) => values.windows.includes(w))
  }
  if (values.wake !== me.wake_time) patch.wake_time = values.wake
  if (values.sleep !== me.sleep_time) patch.sleep_time = values.sleep
  if (values.delay !== me.study_start_delay_minutes) patch.study_start_delay_minutes = values.delay
  const hobbyStart = values.hobbyOn ? values.hobbyStart : null
  const hobbyMinutes = values.hobbyOn ? values.hobbyMinutes : null
  if (hobbyStart !== me.hobby_start || hobbyMinutes !== me.hobby_minutes) {
    patch.hobby_start = hobbyStart
    patch.hobby_minutes = hobbyMinutes
  }
  if (values.rest !== me.rest_days_before_exam) patch.rest_days_before_exam = values.rest
  return patch
}

// The fixed choices, plus the profile's own value when it is not one of them (so it stays selectable).
function choices(fixed: readonly number[], current: number, label: (n: number) => string): ChoiceOption[] {
  const values = fixed.includes(current) ? [...fixed] : [...fixed, current].sort((a, b) => a - b)
  return values.map((n) => ({ value: String(n), label: label(n) }))
}

function hoursLabel(minutes: number): string {
  return minutes % 60 === 0 ? he.onboardingSchedule.hours(minutes / 60) : he.settings.duration(minutes)
}

function delayLabel(minutes: number): string {
  return minutes === 0 ? t.delayNow : he.settings.duration(minutes)
}

// The field messages of a 422 validation_error ({errors: [{loc: ['body', field], type}]}).
function serverFieldErrors(error: unknown): FieldErrors | null {
  if (!(error instanceof ApiError) || error.code !== 'validation_error') return null
  const list = error.details.errors
  if (!Array.isArray(list)) return null
  const found: FieldErrors = {}
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { loc, type } = item as { loc?: unknown; type?: unknown }
    if (!Array.isArray(loc)) continue
    const field = (loc as unknown[]).find((part): part is Field => FIELDS.includes(part as Field))
    if (field === undefined) continue
    found[field] = type === 'same_as_wake_time' ? t.sameTimes : t.invalidField
  }
  return Object.keys(found).length > 0 ? found : null
}

function TimeInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={60}
        required
        value={value}
        onChange={(event) => {
          // A cleared time field reports ''; keep the last whole value instead.
          if (event.target.value !== '') onChange(event.target.value.slice(0, 5))
        }}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand aria-[invalid]:border-danger"
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function FieldMessage({ text }: { text: string | undefined }) {
  return text === undefined ? null : (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  )
}

// The study preferences of spec 7.9. One "שמירה" sends only what changed; a plan field that changed
// offers a replan (ReplanOffer), as plan_affected says.
export function PreferencesForm({ me }: { me: Me }) {
  const updateMe = useUpdateMe()
  const { offer } = useReplanOffer()
  const toast = useToast()
  const windowsErrorId = useId()
  const hobbyHintId = useId()
  const [values, setValues] = useState<Values>(() => fromMe(me))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const patch = changes(me, values)
  const dirty = Object.keys(patch).length > 0

  function set<K extends keyof Values>(key: K, value: Values[K], ...cleared: Field[]) {
    setValues((current) => ({ ...current, [key]: value }))
    setFormError(null)
    if (cleared.length > 0) {
      setErrors((current) => {
        const kept = Object.entries(current).filter(([field]) => !cleared.includes(field as Field))
        return Object.fromEntries(kept)
      })
    }
  }

  function save() {
    if (!dirty || updateMe.isPending) return
    const local: FieldErrors = {}
    if (values.windows.length === 0) local.study_windows = t.windowsRequired
    if (values.wake === values.sleep) local.sleep_time = t.sameTimes
    if (Object.keys(local).length > 0) {
      setErrors(local)
      return
    }
    setErrors({})
    setFormError(null)
    updateMe.mutate(patch, {
      onSuccess: (answer) => {
        if (answer.plan_affected) offer(t.replanReason)
        else toast.show({ text: t.saved, tone: 'success' })
      },
      onError: (error) => {
        const fields = serverFieldErrors(error)
        if (fields === null) setFormError(errorMessage(error))
        else setErrors(fields)
      },
    })
  }

  const afterMidnight = values.sleep < values.wake

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <RadioCards
        label={t.hoursQuestion}
        options={choices(HOUR_MINUTES, me.daily_study_minutes, hoursLabel)}
        value={String(values.minutes)}
        onChange={(value) => {
          set('minutes', Number(value), 'daily_study_minutes')
        }}
        columns="grid-cols-4"
      />
      <FieldMessage text={errors.daily_study_minutes} />

      <div className="flex flex-col gap-2">
        <CheckboxCards
          label={t.windowsQuestion}
          description={t.windowsHint}
          options={WINDOW_OPTIONS}
          value={values.windows}
          onChange={(value) => {
            set('windows', value.filter(isWindow), 'study_windows')
          }}
          {...(errors.study_windows === undefined ? {} : { errorId: windowsErrorId })}
        />
        {errors.study_windows === undefined ? null : (
          <p id={windowsErrorId} role="alert" className="text-sm text-danger">
            {errors.study_windows}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <TimeInput
            label={t.wakeTime}
            value={values.wake}
            onChange={(value) => {
              set('wake', value, 'wake_time', 'sleep_time')
            }}
            error={errors.wake_time}
          />
          <TimeInput
            label={t.sleepTime}
            value={values.sleep}
            onChange={(value) => {
              set('sleep', value, 'wake_time', 'sleep_time')
            }}
            error={errors.sleep_time}
          />
        </div>
        {afterMidnight ? (
          <div className="flex flex-col gap-1 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            <p>{t.afterMidnight}</p>
            {values.rest > 0 ? <p>{t.nightShiftRest}</p> : null}
          </div>
        ) : null}
      </div>

      <RadioCards
        label={t.delayQuestion}
        options={choices(DELAYS, me.study_start_delay_minutes, delayLabel)}
        value={String(values.delay)}
        onChange={(value) => {
          set('delay', Number(value), 'study_start_delay_minutes')
        }}
        columns="grid-cols-4"
      />
      <FieldMessage text={errors.study_start_delay_minutes} />

      <div className="flex flex-col gap-4 rounded-lg border border-line p-3">
        <SwitchField
          isSelected={values.hobbyOn}
          onChange={(on) => {
            set('hobbyOn', on, 'hobby_start', 'hobby_minutes')
          }}
          aria-describedby={hobbyHintId}
          className="flex flex-col"
        >
          <SwitchButton className="group flex min-h-11 cursor-pointer items-center justify-between gap-3 outline-none">
            <span className="text-base font-medium text-ink">{t.hobbyLabel}</span>
            <span
              aria-hidden="true"
              className="flex h-7 w-12 shrink-0 items-center rounded-full border border-line-strong bg-surface-muted px-0.5 transition-colors group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand group-data-[focus-visible]:ring-offset-2 group-data-[selected]:border-brand group-data-[selected]:bg-brand"
            >
              <span className="size-5 rounded-full bg-surface shadow-sm transition-transform group-data-[selected]:-translate-x-5 ltr:group-data-[selected]:translate-x-5" />
            </span>
          </SwitchButton>
        </SwitchField>
        <p id={hobbyHintId} className="-mt-3 text-sm text-ink-muted">
          {t.hobbyHint}
        </p>
        {values.hobbyOn ? (
          <>
            <TimeInput
              label={t.hobbyStart}
              value={values.hobbyStart}
              onChange={(value) => {
                set('hobbyStart', value, 'hobby_start')
              }}
              error={errors.hobby_start}
            />
            <RadioCards
              label={t.hobbyMinutes}
              options={choices(HOBBY_LENGTHS, me.hobby_minutes ?? HOBBY_DEFAULT_MINUTES, he.settings.duration)}
              value={String(values.hobbyMinutes)}
              onChange={(value) => {
                set('hobbyMinutes', Number(value), 'hobby_minutes')
              }}
              columns="grid-cols-3"
            />
            <FieldMessage text={errors.hobby_minutes} />
          </>
        ) : null}
      </div>

      <RadioCards
        label={t.restQuestion}
        options={choices(REST_DAYS, me.rest_days_before_exam, t.restDays)}
        value={String(values.rest)}
        onChange={(value) => {
          set('rest', Number(value), 'rest_days_before_exam')
        }}
        columns="grid-cols-4"
      />
      <FieldMessage text={errors.rest_days_before_exam} />

      {formError === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" className="w-full sm:w-auto sm:self-start" isDisabled={!dirty || updateMe.isPending}>
        {updateMe.isPending ? t.saving : t.save}
      </Button>
    </form>
  )
}
