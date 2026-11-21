import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import { ApiError, type ApiClient } from '../api/client'
import { useUserId } from '../api/me'
import { useStorage, type StorageClient } from '../auth/storage'
import { materialsKey } from './api'
import type { MaterialKind, MaterialMime, MaterialRegister, MaterialRegisterResponse } from './types'

// The API's limit (design doc 7.7): checked here first, so a too big file never leaves the browser.
export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024

const MIME_BY_EXTENSION: Readonly<Record<string, MaterialMime>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}
const ACCEPTED_MIMES: ReadonlySet<string> = new Set(Object.values(MIME_BY_EXTENSION))

// The API's limit of materials per exam (design doc 7.7), checked here when several files are picked at once.
export const MAX_MATERIALS_PER_EXAM = 15

// For <input accept> / a FileTrigger's acceptedFileTypes.
export const ACCEPTED_FILE_TYPES: readonly string[] = [...ACCEPTED_MIMES, '.pdf', '.jpg', '.jpeg', '.png']

// A failure before the API was asked: `code` is one of en.codes (unsupported_file, file_too_large, storage_unavailable).
export class UploadError extends Error {
  readonly code: string

  constructor(code: string, options?: ErrorOptions) {
    super(code, options)
    this.name = 'UploadError'
    this.code = code
  }
}

// The file's mime, from the browser or else from the extension; null when it is not one the API reads.
export function materialMime(file: { name: string; type: string }): MaterialMime | null {
  if (file.type !== '') return ACCEPTED_MIMES.has(file.type) ? (file.type as MaterialMime) : null
  const dot = file.name.lastIndexOf('.')
  if (dot === -1) return null
  return MIME_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()] ?? null
}

// Why the API would refuse this file whatever happens (unsupported_file, file_too_large), or null.
export function fileProblem(file: { name: string; type: string; size: number }): UploadError | null {
  if (materialMime(file) === null) return new UploadError('unsupported_file')
  if (file.size > MAX_MATERIAL_BYTES) return new UploadError('file_too_large')
  return null
}

// The id of a new material. The browser picks it once per file and keeps it across retries, so a retry
// never leaves a second object in Storage or registers the file twice.
export function newMaterialId(): string {
  return crypto.randomUUID()
}

// Storage answers 409 when the object is there already. With upsert: false and a fresh id under the
// user's own folder, that object can only be an earlier try of this same upload that got through.
function isDuplicateObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown }
  return String(statusCode) === '409' || status === 409
}

// The default kind of a file by its name (S13 decision 11). Past exams are the input that matters most,
// so they are the default. The user can change it before the upload.
export function guessKind(filename: string): MaterialKind {
  const name = filename.toLowerCase()
  if (name.includes('פתרון') || name.includes('solution')) return 'solution'
  if (name.includes('סילבוס') || name.includes('syllabus')) return 'syllabus'
  if (name.includes('סיכום') || name.includes('summary')) return 'summary'
  return 'past_exam'
}

export interface UploadMaterialInput {
  storage: StorageClient
  api: ApiClient
  userId: string
  examId: string
  // From newMaterialId(), the same on every try of this file.
  id: string
  file: File
  kind: MaterialKind
  // The file reached Storage on an earlier try: only the register is sent again.
  stored?: boolean
}

// Uploads the file to Storage under the material's id, then registers it with the API, which queues the
// ingest job. An upload that fails never registers, so the API never sees a missing file.
// A failure of the upload is an UploadError; a failure of the register is the ApiError itself, and it means
// the file is in Storage (the caller retries with stored: true).
// Resolves null when a register retry finds the material already registered: the earlier answer was lost.
export async function uploadMaterial({
  storage,
  api,
  userId,
  examId,
  id,
  file,
  kind,
  stored = false,
}: UploadMaterialInput): Promise<MaterialRegisterResponse | null> {
  const problem = fileProblem(file)
  if (problem !== null) throw problem
  const mime = materialMime(file) as MaterialMime

  if (!stored) {
    let failure: unknown
    try {
      const { error } = await storage.upload(`${userId}/${examId}/${id}`, file, { contentType: mime, upsert: false })
      failure = error
    } catch (error) {
      failure = error
    }
    if (failure !== null && !isDuplicateObject(failure)) throw new UploadError('storage_unavailable', { cause: failure })
  }

  const body: MaterialRegister = { id, filename: file.name, kind, mime, size_bytes: file.size }
  try {
    return await api.post<MaterialRegisterResponse>(`/exams/${examId}/materials`, body)
  } catch (error) {
    // On a first register the id cannot be taken by us, so already_exists there stays an error.
    if (stored && error instanceof ApiError && error.code === 'already_exists') return null
    throw error
  }
}

export interface UploadMaterialVariables {
  id: string
  file: File
  kind: MaterialKind
  stored: boolean
}

// The upload as a mutation of one exam; the exam's materials list refetches afterwards, success or not,
// and the mutation settles only after that refetch (so a null answer already has the material in the list).
export function useUploadMaterial(
  examId: string,
): UseMutationResult<MaterialRegisterResponse | null, UploadError | ApiError, UploadMaterialVariables> {
  const api = useApi()
  const storage = useStorage()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<MaterialRegisterResponse | null, UploadError | ApiError, UploadMaterialVariables>({
    mutationFn: ({ id, file, kind, stored }) => {
      if (userId === null) return Promise.reject(new UploadError('unauthenticated'))
      return uploadMaterial({ storage, api, userId, examId, id, file, kind, stored })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: materialsKey(userId, examId) }),
  })
}
