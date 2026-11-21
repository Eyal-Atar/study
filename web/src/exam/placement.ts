import { errorMessage } from '../api/client'
import { unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { useReplanOffer } from '../plan/replanOfferContext'
import { useToast } from '../ui/useToast'
import { useTaskUndo } from './api'
import type { TaskWriteResponse } from './types'

const t = en.exam.tasks

// What the screen says after a task write (plan decision "small change", spec 7.6 step 8):
// - placement null: the board did not need to change, "נשמר".
// - placed: the board changed; with a version, a toast with "בטל" that sends POST /plan/undo.
// - placed false: the fields are saved but the task is off the board, so the replan offer opens
//   with the reason.
export function usePlacementFeedback() {
  const toast = useToast()
  const { offer } = useReplanOffer()
  const undo = useTaskUndo()

  return (answer: TaskWriteResponse, texts: { saved: string; placed: string }) => {
    const placement = answer.placement
    if (placement !== null && !placement.placed) {
      offer(placement.reason === null ? t.notPlacedNoReason : t.notPlaced(unscheduledText(placement.reason)))
      return
    }
    const versionId = answer.version_id
    if (placement === null || versionId === null) {
      toast.show({ text: placement === null ? texts.saved : texts.placed, tone: 'success' })
      return
    }
    toast.show({
      text: texts.placed,
      action: {
        label: en.common.undo,
        onAction: () => {
          undo(versionId).then(
            () => toast.show({ text: t.undone, tone: 'success' }),
            (error: unknown) => toast.show({ text: errorMessage(error), tone: 'error' }),
          )
        },
      },
    })
  }
}

// The delete of a task: sent at once (a soft delete with a version, plan "why delete at once"),
// then "בטל" for 10 seconds that sends POST /plan/undo.
export function useTaskDeleteFeedback() {
  const toast = useToast()
  const undo = useTaskUndo()
  return (versionId: string | null) => {
    toast.show({
      text: t.deleted,
      ...(versionId === null
        ? {}
        : {
            action: {
              label: en.common.undo,
              onAction: () => {
                undo(versionId).then(
                  () => toast.show({ text: t.restored, tone: 'success' }),
                  (error: unknown) => toast.show({ text: errorMessage(error), tone: 'error' }),
                )
              },
            },
          }),
    })
  }
}
