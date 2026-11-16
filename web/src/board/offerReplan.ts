import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { he } from '../i18n/he'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'

export const REPORT_PATH = '/today'
export const REPORT_HASH = '#report'

// The one place the board offers a replan (decision 5 of the S14 plan). S13's ReplanOffer is not in
// main yet, so for now the offer is a toast with the reason and a link to the report on /today.
// After S13 merges this becomes: `return useReplanOffer().offer`.
export function useOfferReplan(): (reasonText?: string) => void {
  const toast = useToast()
  const navigate = useNavigate()
  return useCallback(
    (reasonText?: string) => {
      toast.show({
        text: reasonText ?? he.board.replanOffer,
        action: {
          label: he.board.toReport,
          onAction: () => {
            void navigate({ pathname: REPORT_PATH, hash: REPORT_HASH })
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
      })
    },
    [toast, navigate],
  )
}
