import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiClient, ApiError } from '../api/client'
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

// For <input accept> / a FileTrigger's acceptedFileTypes.
export const ACCEPTED_FILE_TYPES: readonly string[] = [...ACCEPTED_MIMES, '.pdf', '.jpg', '.jpeg', '.png']

// A failure before the API was asked: `code` is one of he.codes (unsupported_file, file_too_large, storage_unavailable).
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
  file: File
  kind: MaterialKind
}

// The browser picks the material id, uploads the file to Storage under it, then registers it with the API,
// which queues the ingest job. An upload that fails never registers, so the API never sees a missing file.
// A register that fails after the upload leaves an orphan object, which the API never reads.
export async function uploadMaterial({ storage, api, userId, examId, file, kind }: UploadMaterialInput): Promise<MaterialRegisterResponse> {
  const mime = materialMime(file)
  if (mime === null) throw new UploadError('unsupported_file')
  if (file.size > MAX_MATERIAL_BYTES) throw new UploadError('file_too_large')

  const id = crypto.randomUUID()
  let failure: unknown
  try {
    const { error } = await storage.upload(`${userId}/${examId}/${id}`, file, { contentType: mime, upsert: false })
    failure = error
  } catch (error) {
    failure = error
  }
  if (failure !== null) throw new UploadError('storage_unavailable', { cause: failure })

  const body: MaterialRegister = { id, filename: file.name, kind, mime, size_bytes: file.size }
  return api.post<MaterialRegisterResponse>(`/exams/${examId}/materials`, body)
}

export interface UploadMaterialVariables {
  file: File
  kind: MaterialKind
}

// The upload as a mutation of one exam; the exam's materials list refetches afterwards, success or not.
export function useUploadMaterial(
  examId: string,
): UseMutationResult<MaterialRegisterResponse, UploadError | ApiError, UploadMaterialVariables> {
  const api = useApi()
  const storage = useStorage()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<MaterialRegisterResponse, UploadError | ApiError, UploadMaterialVariables>({
    mutationFn: ({ file, kind }) => {
      if (userId === null) return Promise.reject(new UploadError('unauthenticated'))
      return uploadMaterial({ storage, api, userId, examId, file, kind })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: materialsKey(userId, examId) }),
  })
}
