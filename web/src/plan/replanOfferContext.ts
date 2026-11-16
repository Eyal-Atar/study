import { createContext, useContext } from 'react'

// The offer to replan the board (ReplanOffer.tsx renders it). AppShell holds one, so any screen can
// open it: the timezone sync (S13), plan_affected and a failed placement (S14/S15).
export interface ReplanOfferApi {
  // Opens the dialog. reasonText says why a replan is offered, above the preview.
  offer: (reasonText?: string) => void
}

export const ReplanOfferContext = createContext<ReplanOfferApi | null>(null)

export function useReplanOffer(): ReplanOfferApi {
  const value = useContext(ReplanOfferContext)
  if (value === null) throw new Error('useReplanOffer() must be used inside <ReplanOfferProvider>')
  return value
}
