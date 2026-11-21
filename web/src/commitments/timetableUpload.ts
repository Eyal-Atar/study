import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { ApiError } from '../api/client'
import { useUserId } from '../api/me'
import { useStorage, type StorageClient } from '../auth/storage'
import { useRegisterTimetable } from '../availability/api'
import type { TimetableRegister, TimetableRegisterResponse } from '../availability/types'
import { MAX_MATERIAL_BYTES, materialMime, storeObject, UploadError } from '../onboarding/upload'
import { downscaleImage } from './downscale'

export type TimetableMime = TimetableRegister['mime']

// A PDF goes up as it is, within the limit of a material (services/timetables.py size_limit).
export const MAX_TIMETABLE_PDF_BYTES = MAX_MATERIAL_BYTES

// The same three kinds as a material (JPEG, PNG, PDF), by the browser's type or the extension.
export function timetableMime(file: { name: string; type: string }): TimetableMime | null {
  return materialMime(file)
}

// Why the API would refuse this file before anything is sent. An image of any size is fine here:
// it is made smaller first, and downscaleImage says file_too_large if even that does not fit.
export function timetableFileProblem(file: { name: string; type: string; size: number }): 'unsupported_file' | 'file_too_large' | null {
  const mime = timetableMime(file)
  if (mime === null) return 'unsupported_file'
  if (mime === 'application/pdf' && file.size > MAX_TIMETABLE_PDF_BYTES) return 'file_too_large'
  return null
}

// Where the API expects the file in the materials bucket (domain/materials.py timetable_path).
export function timetablePath(userId: string, id: string): string {
  return `${userId}/timetables/${id}`
}

export interface UploadTimetableInput {
  storage: StorageClient
  userId: string
  // A fresh UUID for this upload.
  id: string
  file: File
  // POST /timetables (useRegisterTimetable's mutateAsync).
  register: (body: TimetableRegister) => Promise<TimetableRegisterResponse>
}

// Checks the file, makes a photo smaller (JPEG), puts it in Storage, then registers it. Nothing is
// sent for a file the API would refuse, and an upload that fails never registers. A failure before
// the API is an UploadError (unsupported_file, file_too_large, image_unreadable,
// storage_unavailable); a failure of the register is the ApiError itself.
export async function uploadTimetable({ storage, userId, id, file, register }: UploadTimetableInput): Promise<TimetableRegisterResponse> {
  const problem = timetableFileProblem(file)
  if (problem !== null) throw new UploadError(problem)
  const original = timetableMime(file) as TimetableMime

  let body: Blob = file
  let mime: TimetableMime = original
  if (original !== 'application/pdf') {
    body = await downscaleImage(file)
    // A redrawn photo is a JPEG; one that already fit keeps its own type.
    if (body !== file) mime = 'image/jpeg'
  }

  await storeObject(storage, timetablePath(userId, id), body, mime)
  return register({ id, mime, size_bytes: body.size })
}

// The upload as a mutation: the file in, the job to poll out (GET /jobs/{job_id}).
export function useUploadTimetable(): UseMutationResult<TimetableRegisterResponse, UploadError | ApiError, File> {
  const storage = useStorage()
  const userId = useUserId()
  const { mutateAsync: register } = useRegisterTimetable()
  return useMutation<TimetableRegisterResponse, UploadError | ApiError, File>({
    mutationFn: (file) => {
      if (userId === null) return Promise.reject(new UploadError('unauthenticated'))
      return uploadTimetable({ storage, userId, id: crypto.randomUUID(), file, register })
    },
  })
}
