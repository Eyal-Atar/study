import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { FileTrigger } from 'react-aria-components'
import { ApiError, errorMessage } from '../api/client'
import { useUserId } from '../api/me'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { materialsKey, useDeleteMaterial, useMaterials } from './api'
import { MaterialItem } from './MaterialItem'
import { cancelDelete, sendDelete, waitToDelete } from './pendingDeletes'
import type { Exam, Material, MaterialKind } from './types'
import {
  ACCEPTED_FILE_TYPES,
  fileProblem,
  guessKind,
  MAX_MATERIAL_BYTES,
  MAX_MATERIALS_PER_EXAM,
  newMaterialId,
  UploadError,
  useUploadMaterial,
} from './upload'

const t = he.onboardingMaterials

// A file the user picked that is not registered yet: uploading (error null), or failed before the API
// took it (Storage, the register call, or the checks of uploadMaterial).
// `id` is the material id, picked once and kept for every retry; `stored` says the file is in Storage
// already, so a retry sends only the register (no second object, no second material).
interface PendingUpload {
  id: string
  file: File
  kind: MaterialKind
  stored: boolean
  error: unknown
}

function uploadErrorText(error: unknown): string {
  if (error instanceof UploadError) {
    // The browser checks know the limits, so the texts say them like the API's answers do.
    if (error.code === 'file_too_large') return codeText(error.code, { limit_bytes: MAX_MATERIAL_BYTES })
    if (error.code === 'too_many_materials') return codeText(error.code, { limit: MAX_MATERIALS_PER_EXAM })
    return codeText(error.code)
  }
  return errorMessage(error)
}

// Answers that a retry would get again: the file's type or size, a full exam, or an exam that is gone.
// They get only "הסרה".
const FINAL_CODES: ReadonlySet<string> = new Set(['unsupported_file', 'file_too_large', 'too_many_materials', 'not_found'])

function canRetry(error: unknown): boolean {
  const code = error instanceof UploadError || error instanceof ApiError ? error.code : null
  return code === null || !FINAL_CODES.has(code)
}

function materialStatus(material: Material): { status: string; tone: 'muted' | 'success' | 'danger' } {
  switch (material.ingest_status) {
    case 'ready':
      return { status: t.ready(material.page_count), tone: 'success' }
    case 'failed':
      return { status: material.ingest_error === null ? he.errors.generic : codeText(material.ingest_error), tone: 'danger' }
    default:
      return { status: t.processing, tone: 'muted' }
  }
}

// One exam of the materials step: its name, the file picker, and its files. A file uploads as soon as it is
// picked, with the kind its name suggests (decision 11), so the step stays one tap per file.
export function ExamMaterials({ exam, onCountChange }: { exam: Exam; onCountChange: (examId: string, count: number) => void }) {
  const headingId = useId()
  const userId = useUserId()
  const queryClient = useQueryClient()
  const toast = useToast()
  const materials = useMaterials(exam.id)
  const upload = useUploadMaterial(exam.id)
  const deleteMaterial = useDeleteMaterial()
  const [pending, setPending] = useState<PendingUpload[]>([])
  // Materials deleted on screen whose DELETE waits for the undo toast to expire.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())

  const visible = (materials.data ?? []).filter((m) => !hidden.has(m.id))
  const count = visible.length + pending.length

  // The step shows "הבא" instead of "דלג" once any exam has a file.
  useEffect(() => {
    onCountChange(exam.id, count)
  }, [exam.id, count, onCountChange])

  function start(item: PendingUpload) {
    upload.mutateAsync({ id: item.id, file: item.file, kind: item.kind, stored: item.stored }).then(
      (answer) => {
        // The hook already refetched the list; this puts the new material in even if that refetch lost a race,
        // so the row never blinks out between "מעלה…" and "קוראים את הקובץ…". A null answer (registered on
        // an earlier try) has nothing to add: the refetch brought it.
        if (answer !== null) {
          queryClient.setQueryData<Material[]>(materialsKey(userId, exam.id), (list = []) =>
            list.some((m) => m.id === answer.material.id) ? list : [...list, answer.material],
          )
        }
        setPending((rows) => rows.filter((row) => row.id !== item.id))
      },
      (error: unknown) => {
        // An ApiError comes from the register, which runs only after the file reached Storage.
        const stored = item.stored || error instanceof ApiError
        setPending((rows) => rows.map((row) => (row.id === item.id ? { ...row, stored, error } : row)))
      },
    )
  }

  // Files that still count toward the exam's limit: the materials on screen (failed ones too, as on the
  // server) and the uploads that may still register.
  function filesTaken(): number {
    return visible.length + pending.filter((row) => row.error === null || canRetry(row.error)).length
  }

  function pick(files: FileList | null) {
    if (files === null) return
    let room = MAX_MATERIALS_PER_EXAM - filesTaken()
    const items = Array.from(files, (file): PendingUpload => {
      const item: PendingUpload = { id: newMaterialId(), file, kind: guessKind(file.name), stored: false, error: null }
      // A file the API would refuse anyway takes no place; uploadMaterial turns it down without the network.
      if (fileProblem(file) !== null) return item
      if (room <= 0) return { ...item, error: new UploadError('too_many_materials') }
      room -= 1
      return item
    })
    setPending((rows) => [...rows, ...items])
    items.filter((item) => item.error === null).forEach(start)
  }

  function retry(item: PendingUpload) {
    const again = { ...item, error: null }
    setPending((rows) => rows.map((row) => (row.id === item.id ? again : row)))
    start(again)
  }

  function drop(item: PendingUpload) {
    setPending((rows) => rows.filter((row) => row.id !== item.id))
  }

  // A material delete is hard on the server, so the screen hides the file, offers "בטל" for 10 seconds,
  // and sends DELETE only when the toast goes away without it (S13, "why a material delete waits").
  function remove(material: Material) {
    const show = () => {
      setHidden((ids) => {
        const next = new Set(ids)
        next.delete(material.id)
        return next
      })
    }
    setHidden((ids) => new Set(ids).add(material.id))
    const key = toast.show({
      text: t.deleted(material.filename),
      action: {
        label: he.common.undo,
        onAction: () => {
          cancelDelete(material.id)
          show()
        },
      },
      timeoutMs: UNDO_TIMEOUT_MS,
      onExpire: () => {
        // One promise per delete: the mutation's own onError would reach only the last of two deletes
        // that expire together. The step waits on it (pendingDeletes) before it moves on.
        sendDelete(material.id, () =>
          deleteMaterial.mutateAsync(material.id).then(
            () => true,
            (error: unknown) => {
              show()
              toast.show({ text: `${t.deleteFailed(material.filename)} ${errorMessage(error)}`, tone: 'error' })
              return false
            },
          ),
        )
      },
    })
    waitToDelete(material.id, () => {
      toast.close(key)
    })
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-line py-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="min-w-0 truncate text-base font-semibold text-ink">
          <bdi>{exam.name}</bdi>
        </h2>
        <FileTrigger acceptedFileTypes={[...ACCEPTED_FILE_TYPES]} allowsMultiple onSelect={pick}>
          <Button variant="secondary" aria-label={t.addFilesFor(exam.name)}>
            {t.addFiles}
          </Button>
        </FileTrigger>
      </div>

      {materials.isPending ? (
        <p className="mt-3 text-sm text-ink-muted">{he.common.loading}</p>
      ) : materials.isError ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-danger">
            {errorMessage(materials.error)}
          </p>
          <Button variant="quiet" onPress={() => void materials.refetch()}>
            {he.common.retry}
          </Button>
        </div>
      ) : count === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t.empty}</p>
      ) : null}

      {count === 0 ? null : (
        <ul aria-label={t.filesOf(exam.name)} className="mt-2 divide-y divide-line">
          {visible.map((material) => {
            const { status, tone } = materialStatus(material)
            return (
              <MaterialItem
                key={material.id}
                filename={material.filename}
                kind={material.kind}
                status={status}
                tone={tone}
                warnings={material.warnings.map((code) => codeText(code))}
                actions={
                  <Button variant="quiet" aria-label={t.deleteNamed(material.filename)} onPress={() => { remove(material); }}>
                    {he.common.delete}
                  </Button>
                }
              />
            )
          })}
          {pending.map((item) =>
            item.error === null ? (
              <MaterialItem key={item.id} filename={item.file.name} kind={item.kind} status={t.uploading} tone="muted" />
            ) : (
              <MaterialItem
                key={item.id}
                filename={item.file.name}
                kind={item.kind}
                status={uploadErrorText(item.error)}
                tone="danger"
                actions={
                  <>
                    {canRetry(item.error) ? (
                      <Button variant="quiet" aria-label={t.retryNamed(item.file.name)} onPress={() => { retry(item); }}>
                        {he.common.retry}
                      </Button>
                    ) : null}
                    <Button variant="quiet" aria-label={t.removeNamed(item.file.name)} onPress={() => { drop(item); }}>
                      {t.remove}
                    </Button>
                  </>
                }
              />
            ),
          )}
        </ul>
      )}
    </section>
  )
}
