import { useQueryClient } from '@tanstack/react-query'
import { createElement, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { commitmentsKey, useCommitments, useCreateCommitment, useDeleteCommitment } from '../availability/api'
import type { Commitment } from '../availability/types'
import { useBoardUserId } from '../board/api'
import { CommitmentDialog } from '../commitments/CommitmentDialog'
import { kindIcon } from '../commitments/kindIcon'
import { cellsOf, groupCommitments, groupSubtitle, paintedRanges, type CommitmentGroup } from '../commitments/model'
import { TimetableImport } from '../commitments/TimetableImport'
import { WeekPainter } from '../commitments/WeekPainter'
import { todayIn } from '../exam/dates'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { IconButton } from '../ui/IconButton'
import { Plus, Trash2 } from '../ui/icons'
import { Note } from '../ui/Note'
import { ErrorState, LoadingState } from '../ui/states'
import { cx, FOCUS_RING_NATIVE, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { useExams } from './api'
import { feasibility } from './feasibility'
import { FeasibilityNote } from './FeasibilityNote'
import { clearMarkedCells, markedCells, setMarkedCells, useMarkedCells, weekHours } from './markedHours'
import { OnboardingLayout } from './OnboardingLayout'
import { flushDeletes } from './pendingDeletes'
import { STEP_PATHS } from './steps'

const t = en.onboardingFlow.fixedHours

type Answer = 'no' | 'yes'

// The two answers side by side, as toggle buttons. The chosen one has the brand's 2px border on
// its soft fill (the prototype's step 4).
function AnswerButton({ pressed, disabled, onPress, children }: { pressed: boolean; disabled: boolean; onPress: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      className={cx(
        'inline-flex min-h-touch cursor-pointer items-center justify-center rounded-button px-4 text-small disabled:cursor-not-allowed',
        'motion-safe:transition-colors motion-safe:duration-(--duration-fast)',
        FOCUS_RING_NATIVE,
        pressed
          ? 'border-2 border-brand bg-brand-soft font-semibold text-brand-strong'
          : 'border border-line-strong bg-field font-medium text-ink hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  )
}

// Onboarding step 4 of 4 (S34 decisions 4–7, 19): the hours that are already taken. "No, I’m
// flexible" goes on to the build at once. "Yes, I do" opens the small week, where the student marks
// whole hours; exact hours go through the dialog, and a photo of the timetable through
// TimetableImport. Both of those save at once; the marked hours are saved by "Build my plan".
//
// The marked hours live in the markedHours store, not in this component: "Back" saves nothing, and
// they are still marked when the student returns (steps 1 and 3 count them too).
// Marked hours are sent one range at a time. Each range that went through moves from marked to
// saved, so after a failure a second press sends only what is still marked, never a duplicate.
// Before the build, the material deletes still waiting from step 2 are sent (flushDeletes): the
// plan must not analyse a file the student deleted.
export function FixedHoursStep() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  const me = useMe()
  const exams = useExams()
  const commitments = useCommitments()
  const create = useCreateCommitment()
  const remove = useDeleteCommitment()

  const [chosen, setChosen] = useState<Answer | null>(null)
  // Coming back to the step with busy times already saved, or hours still marked, chooses "Yes" for
  // the student, once: deleting them all afterwards leaves the week open.
  const [seeded, setSeeded] = useState(false)
  const painted = useMarkedCells()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [problem, setProblem] = useState<{ title?: string; text: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeProblem, setRemoveProblem] = useState<string | null>(null)

  const profile = me.data
  const saved = commitments.data
  // Me time is a preference, not a busy time the student marked: it counts as taken time, and is
  // not listed here (as in the settings).
  const groups = groupCommitments(saved ?? []).filter((group) => !group.isMeTime)
  if (!seeded && saved !== undefined) {
    setSeeded(true)
    if (groups.length > 0 || painted.size > 0) setChosen('yes')
  }

  const { firstHour, lastHour } = weekHours(profile?.wake_time ?? '08:00', profile?.sleep_time ?? '23:00')
  // The week shows only the busy times listed under it (decision 2: Me time is never a busy time
  // on screen), so every saved cell can be freed from the list.
  const listedIds = new Set(groups.flatMap((group) => group.ids))
  const savedCells = cellsOf((saved ?? []).filter((c) => listedIds.has(c.id)), firstHour, lastHour)
  // A marked hour that a busy time from the dialog or the photo now covers is saved already, and
  // stops being marked for good: deleting that busy time later frees the hour, it does not mark it
  // again.
  const marked = new Set([...painted].filter((cell) => !savedCells.has(cell)))
  const covered = marked.size !== painted.size
  useEffect(() => {
    if (covered) setMarkedCells(new Set([...markedCells()].filter((cell) => !savedCells.has(cell))))
  })
  const ranges = chosen === 'yes' ? paintedRanges(marked, firstHour) : []

  // Decision 7: the saved busy times and the hours only marked, together.
  const estimate =
    profile === undefined || exams.data === undefined || saved === undefined
      ? null
      : feasibility({
          today: todayIn(profile.timezone),
          exams: exams.data.map((exam) => ({ name: exam.name, exam_date: exam.exam_date })),
          profile,
          busy: [...saved, ...ranges],
        })

  // A busy time that went through: it is on the list at once (the refetch the write started
  // follows), and its hours stop being marked.
  function keep(commitment: Commitment) {
    queryClient.setQueryData<Commitment[]>(commitmentsKey(userId), (old) =>
      old === undefined || old.some((c) => c.id === commitment.id) ? old : [...old, commitment],
    )
    const done = cellsOf([commitment], firstHour, lastHour)
    setMarkedCells(new Set([...markedCells()].filter((cell) => !done.has(cell))))
  }

  // save: whether the marked hours are sent first. "No, I’m flexible" never sends them, whatever
  // was marked before the student changed their mind.
  async function leave(save: boolean) {
    if (leaving || profile === undefined) return
    setLeaving(true)
    setProblem(null)
    const today = todayIn(profile.timezone)
    for (const range of save ? ranges : []) {
      try {
        const answer = await create.mutateAsync({
          title: en.commitments.defaultTitle,
          kind: 'other',
          ...range,
          valid_from: today,
        })
        keep(answer.commitment)
      } catch (error) {
        setProblem({ title: t.saveFailed, text: errorMessage(error) })
        setLeaving(false)
        return
      }
    }
    // Every marked hour is saved now, or the student said they have none.
    clearMarkedCells()
    if (!(await flushDeletes())) {
      setProblem({ text: t.deletesFailed })
      setLeaving(false)
      return
    }
    await navigate(STEP_PATHS.building)
  }

  async function removeGroup(group: CommitmentGroup) {
    if (removing !== null) return
    setRemoving(group.key)
    setRemoveProblem(null)
    try {
      for (const id of group.ids) await remove.mutateAsync(id)
    } catch {
      // Some days may be gone and some not: the list shows what is really there.
      await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
      setRemoveProblem(t.removeFailed)
    }
    setRemoving(null)
  }

  const loading = me.isPending || commitments.isPending
  const loadError = me.isError ? me.error : commitments.isError ? commitments.error : null

  return (
    <OnboardingLayout
      step={4}
      mood="flow"
      question={t.question}
      below={t.below}
      bare
      primary={
        profile === undefined || saved === undefined ? null : (
          <Button className="flex-1 md:flex-none" isPending={leaving} onPress={() => void leave(true)}>
            {en.onboardingSchedule.build}
          </Button>
        )
      }
    >
      {loadError !== null ? (
        <ErrorState
          message={errorMessage(loadError)}
          onRetry={() => {
            if (me.isError) void me.refetch()
            if (commitments.isError) void commitments.refetch()
          }}
        />
      ) : loading ? (
        <LoadingState shape="card" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <AnswerButton
              pressed={chosen === 'no'}
              disabled={leaving}
              onPress={() => {
                setChosen('no')
                void leave(false)
              }}
            >
              {t.no}
            </AnswerButton>
            <AnswerButton
              pressed={chosen === 'yes'}
              disabled={leaving}
              onPress={() => {
                setChosen('yes')
              }}
            >
              {t.yes}
            </AnswerButton>
          </div>

          {chosen === 'yes' ? (
            <div className="flex flex-col gap-2">
              <WeekPainter
                firstHour={firstHour}
                lastHour={lastHour}
                painted={marked}
                saved={savedCells}
                onChange={setMarkedCells}
              />
              <div>
                <Button
                  variant="quiet"
                  className="-ms-3"
                  onPress={() => {
                    setDialogOpen(true)
                  }}
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
                  {t.addExact}
                </Button>
              </div>
              <TimetableImport buttonVariant="onboarding" onApplied={() => undefined} />
            </div>
          ) : null}

          <FeasibilityNote estimate={estimate} />

          {groups.length > 0 ? (
            <Card>
              <ul role="list" aria-label={t.savedLabel} className="flex flex-col">
                {groups.map((group) => (
                  <SavedRow
                    key={group.key}
                    group={group}
                    disabled={removing !== null}
                    onRemove={() => void removeGroup(group)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}

          {removeProblem === null ? null : (
            <Note tone="warning" role="alert">
              {removeProblem}
            </Note>
          )}
          {problem === null ? null : (
            <Note tone="warning" role="alert" title={problem.title}>
              {problem.text}
            </Note>
          )}

          <CommitmentDialog
            isOpen={dialogOpen}
            onOpenChange={setDialogOpen}
            group={null}
            // There is no plan yet, so nothing to offer: the list refreshes by itself.
            onSaved={() => undefined}
          />
        </>
      )}
    </OnboardingLayout>
  )
}

// One saved busy time: the icon of its kind, its title (user content), its days and hours, and a
// delete button named after all of them.
function SavedRow({ group, disabled, onRemove }: { group: CommitmentGroup; disabled: boolean; onRemove: () => void }) {
  const when = groupSubtitle(group)
  // createElement: the icon is one of three fixed components, picked by kind, not made here.
  const icon = createElement(kindIcon(group.kind), {
    'aria-hidden': true,
    size: 18,
    strokeWidth: ICON_STROKE,
    className: 'shrink-0 text-busy',
  })
  return (
    <li className="flex min-h-touch items-center gap-3 border-t border-line py-1 first:border-t-0">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <UserText truncate className="text-body font-medium text-ink">
          {group.title}
        </UserText>
        <span className="text-small text-ink-muted tabular-nums">{when}</span>
      </span>
      <IconButton aria-label={t.remove(group.title, when)} isDisabled={disabled} onPress={onRemove} className="-me-3">
        <Trash2 aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
      </IconButton>
    </li>
  )
}
