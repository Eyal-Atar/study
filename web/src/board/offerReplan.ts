import { useReplanOffer } from '../plan/replanOfferContext'

// /today#report scrolls to the report (a link can point there).
export const REPORT_HASH = '#report'

// The one place the board offers a replan (decision 5 of the S14 plan): S13's ReplanOffer, which
// shows the preview and applies it with its basis.
export function useOfferReplan(): (reasonText?: string) => void {
  return useReplanOffer().offer
}
