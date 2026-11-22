import { useQueryClient } from '@tanstack/react-query'
import { createElement, useId, useState } from 'react'
import { errorMessage } from '../api/client'
import { commitmentsKey, useCommitments, useCreateCommitment } from '../availability/api'
import type { CommitmentInput } from '../availability/types'
import { useBoardUserId } from '../board/api'
import { CommitmentDialog } from '../commitments/CommitmentDialog'
import { kindIcon } from '../commitments/kindIcon'
import { groupCommitments, groupSubtitle, type CommitmentGroup } from '../commitments/model'
import { TimetableImport } from '../commitments/TimetableImport'
import { en } from '../i18n/en'
import { useReplanOffer } from '../plan/replanOfferContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ChevronRight, Plus } from '../ui/icons'
import { ErrorState, LoadingState } from '../ui/states'
import { cx, FOCUS_RING, ICON_STROKE } from '../ui/styles'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { UserText } from '../ui/UserText'

const t = en.settingsScreen.busy

// What the dialog is open for: nothing, a new group, or a group as it was when its row was pressed.
// The dialog keeps its own copy of the group from then on, so a refresh of the list behind it
// (after a partial failure) does not change what it edits.
type Editing = { group: CommitmentGroup | null } | null

// The rows of a deleted group, as POST /commitments takes them back. Only the content is kept:
// the rows Undo creates get new ids.
function recreateInputs(group: CommitmentGroup): CommitmentInput[] {
  return group.weekdays.map((weekday) => ({
    title: group.title,
    kind: group.kind,
    weekday,
    start_time: group.start_time,
    end_time: group.end_time,
    valid_from: group.valid_from,
    ...(group.valid_until === null ? {} : { valid_until: group.valid_until }),
  }))
}

// The rows sit on the card with a line between them, as in the prototype (.rows of the settings).
const ROW_LINE = 'border-t border-line first:border-t-0'

// Busy time in the settings (S34, decisions 2, 15, 17, 18): the student's fixed weekly hours, one
// row per group, each opening CommitmentDialog. The Me time set is a preference (Study preferences)
// and never shows here. A save that touched the plan offers a replan; a delete gets "Undo" for
// UNDO_TIMEOUT_MS instead of "Are you sure?", and the replan is offered only once the delete stands.
export function CommitmentsSection() {
  const headingId = useId()
  const commitments = useCommitments()
  const create = useCreateCommitment()
  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  const toast = useToast()
  const { offer } = useReplanOffer()
  const [editing, setEditing] = useState<Editing>(null)

  const groups = groupCommitments(commitments.data ?? []).filter((g) => !g.isMeTime)

  async function undo(group: CommitmentGroup) {
    try {
      for (const input of recreateInputs(group)) await create.mutateAsync(input)
    } catch {
      // Some days may be back and some not: the list shows what is really there.
      await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
      toast.show({ text: t.undoFailed, tone: 'error' })
    }
  }

  function deleted(group: CommitmentGroup) {
    toast.show({
      text: t.removed,
      timeoutMs: UNDO_TIMEOUT_MS,
      action: {
        label: en.common.undo,
        onAction: () => {
          void undo(group)
        },
      },
      // A delete always frees time on the board (the API answers plan_affected: true).
      onExpire: () => {
        offer(t.replanReason)
      },
    })
  }

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-body font-semibold break-words text-ink">
          {t.title}
        </h2>
        <Button
          variant="quiet"
          className="-me-3"
          onPress={() => {
            setEditing({ group: null })
          }}
        >
          <Plus aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
          {t.add}
        </Button>
      </div>

      {commitments.isPending ? (
        <LoadingState shape="text" rows={2} />
      ) : commitments.isError ? (
        <ErrorState
          message={errorMessage(commitments.error)}
          onRetry={() => {
            void commitments.refetch()
          }}
        />
      ) : (
        <ul role="list" className="flex flex-col">
          {groups.length === 0 ? (
            <li className={cx(ROW_LINE, 'py-2')}>
              <p className="max-w-prose text-small text-ink-muted">{t.empty}</p>
            </li>
          ) : (
            groups.map((group) => <GroupRow key={group.key} group={group} onPress={() => { setEditing({ group }) }} />)
          )}
          <li className={ROW_LINE}>
            <TimetableImport
              buttonVariant="row"
              onApplied={(answer) => {
                if (answer.plan_affected) offer(t.replanReason)
              }}
            />
          </li>
        </ul>
      )}

      <CommitmentDialog
        isOpen={editing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditing(null)
        }}
        group={editing?.group ?? null}
        onSaved={(planAffected) => {
          if (planAffected) offer(t.replanReason)
        }}
        onDeleted={deleted}
      />
    </Card>
  )
}

// One group: the icon of its kind in the busy colour, the title (user content), the days and hours,
// and a chevron. The whole row is the button, so its name is what the row says.
function GroupRow({ group, onPress }: { group: CommitmentGroup; onPress: () => void }) {
  // createElement: the icon is one of three fixed components, picked by kind, not made here.
  const icon = createElement(kindIcon(group.kind), {
    'aria-hidden': true,
    size: 19,
    strokeWidth: ICON_STROKE,
    className: 'shrink-0 text-busy',
  })
  return (
    <li className={ROW_LINE}>
      <button
        type="button"
        onClick={onPress}
        className={cx(
          'flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-control py-2 text-start',
          'hover:bg-surface-muted motion-safe:transition-colors motion-safe:duration-(--duration-fast)',
          FOCUS_RING,
        )}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <UserText truncate className="text-body font-semibold text-ink">
            {group.title}
          </UserText>
          <span className="text-small text-ink-muted tabular-nums">{groupSubtitle(group)}</span>
        </span>
        <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-muted" />
      </button>
    </li>
  )
}
