import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'

// GET /me/export (S15 decision 10): one JSON document with everything the account holds.
export type ExportData = Record<string, unknown>

// DELETE /me: the rows are gone when this answers; the worker job then deletes the files and the
// sign-in account.
export interface DeleteAccountResponse {
  job_id: string
}

export function useExportData(): UseMutationResult<ExportData, ApiError, undefined> {
  const api = useApi()
  return useMutation<ExportData, ApiError, undefined>({
    mutationFn: () => api.get<ExportData>('/me/export'),
  })
}

export function useDeleteAccount(): UseMutationResult<DeleteAccountResponse, ApiError, undefined> {
  const api = useApi()
  return useMutation<DeleteAccountResponse, ApiError, undefined>({
    mutationFn: () => api.delete<DeleteAccountResponse>('/me'),
  })
}

// 'YYYY-MM-DD' of the browser's local day (not UTC: an export at 01:00 in Israel is today's).
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Saves `data` as a file through a temporary <a download>, then frees the object URL.
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Some browsers start the download only after the click handler returns.
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
  }
}
