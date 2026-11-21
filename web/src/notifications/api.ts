import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { meKey, useUserId, type Me, type MePatchResponse } from '../api/me'
import type { SubscriptionBody } from './push'
import { usePushState } from './pushContext'

export interface RegisterAnswer {
  id: string
  created: boolean
}

export type LeadMinutes = 0 | 5 | 10 | 15

// POST /push/subscriptions: an upsert by endpoint, so sending the same subscription again is safe.
// The id is remembered for this user and endpoint, for the DELETE of "Turn off".
export function useRegisterSubscription(): UseMutationResult<RegisterAnswer, ApiError, SubscriptionBody> {
  const api = useApi()
  const userId = useUserId()
  const { known } = usePushState()
  return useMutation<RegisterAnswer, ApiError, SubscriptionBody>({
    mutationFn: (body) => api.post<RegisterAnswer>('/push/subscriptions', body),
    onSuccess: (answer, body) => {
      if (userId !== null) known.set(userId, { id: answer.id, endpoint: body.endpoint })
    },
  })
}

// DELETE /push/subscriptions/{id}.
export function useDeleteSubscription(): UseMutationResult<undefined, ApiError, string> {
  const api = useApi()
  const userId = useUserId()
  const { known } = usePushState()
  return useMutation<undefined, ApiError, string>({
    mutationFn: (id) => api.delete(`/push/subscriptions/${encodeURIComponent(id)}`),
    onSuccess: (_answer, id) => {
      if (userId !== null && known.get(userId)?.id === id) known.delete(userId)
    },
  })
}

// PATCH /me {notify_lead_minutes}. The answer is the whole profile, so it updates the me cache
// without another GET. plan_affected is ignored: the lead time does not move any block.
export function useSetLeadMinutes(): UseMutationResult<MePatchResponse, ApiError, LeadMinutes> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<MePatchResponse, ApiError, LeadMinutes>({
    mutationFn: (minutes) => api.patch<MePatchResponse>('/me', { notify_lead_minutes: minutes }),
    onSuccess: (answer) => {
      queryClient.setQueryData<Me>(meKey(userId), (old) =>
        old === undefined ? old : { ...old, notify_lead_minutes: answer.notify_lead_minutes },
      )
    },
  })
}
