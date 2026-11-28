import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useApi } from './ApiContext'
import type { ApiError } from './client'

export type StudyWindow = 'morning' | 'afternoon' | 'evening' | 'night'

// GET /me (MeResponse in api/app/schemas/me.py).
export interface Me {
  id: string
  email: string | null
  display_name: string | null
  // An IANA zone name, like 'Asia/Jerusalem'.
  timezone: string
  // 'HH:MM'
  wake_time: string
  sleep_time: string
  daily_study_minutes: number
  study_windows: StudyWindow[]
  rest_days_before_exam: number
  notify_lead_minutes: number
  // Minutes after waking before study may start (0–360, S15 decision 1).
  study_start_delay_minutes: number
  // The daily hobby time (S15 decision 2): both null (off) or both set. 'HH:MM', and 15–240 minutes.
  hobby_start: string | null
  hobby_minutes: number | null
  // null until the first plan is written (the API sets it, S13 decision 1).
  onboarding_completed_at: string | null
}

// PATCH /me: any of the editable fields, at least one.
export type MePatch = Partial<
  Pick<
    Me,
    | 'display_name'
    | 'timezone'
    | 'wake_time'
    | 'sleep_time'
    | 'daily_study_minutes'
    | 'study_windows'
    | 'rest_days_before_exam'
    | 'notify_lead_minutes'
    | 'study_start_delay_minutes'
    | 'hobby_start'
    | 'hobby_minutes'
  >
>

export interface MePatchResponse extends Me {
  plan_affected: boolean
}

// The id of the signed-in user, or null. Every query key holds it, so a different user never sees a cached answer.
export function useUserId(): string | null {
  const auth = useAuth()
  // Offline: the snapshot owner, so the restored cache keys match.
  return auth.status === 'signed_in' ? auth.session.user.id : auth.status === 'offline' ? auth.userId : null
}

export function meKey(userId: string | null) {
  return ['me', userId] as const
}

// The signed-in user as the API sees them.
export function useMe(): UseQueryResult<Me, ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<Me, ApiError>({
    queryKey: meKey(userId),
    queryFn: ({ signal }) => api.get<Me>('/me', { signal }),
    enabled: userId !== null,
  })
}
