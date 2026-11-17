import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { FileTrigger } from 'react-aria-components'
import { ApiError, errorMessage } from '../api/client'
import { useUserId } from '../api/me'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { List } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'
import { ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
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
export interface ExamMaterialsProps {
  exam: Exam
  onCountChange: (examId: string, count: number) => void
  // The section's heading; the exam's name by default (the onboarding lists every exam).
  heading?: string
  // A control that changes a registered material's kind, in place of its kind's text (S15).
  kindControl?: (material: Material) => ReactNode
  // Only the "הוספת קבצים" button and the files, without a heading or a section of its own: the
  // exam screen puts this inside a collapsible section that already has the heading (S28).
  bare?: boolean
}

export function ExamMaterials({ exam, onCountChange, heading, kindControl, bare = false }: ExamMaterialsProps) {
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

  // The step says "המשך" instead of "המשך בלי חומרים" once any exam has a file.
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

  const picker = (
    <FileTrigger acceptedFileTypes={[...ACCEPTED_FILE_TYPES]} allowsMultiple onSelect={pick}>
      <Button variant="secondary" aria-label={t.addFilesFor(exam.name)}>
        <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        {t.addFiles}
      </Button>
    </FileTrigger>
  )

  const files = (
    <>
      {materials.isPending ? (
        <LoadingState shape="list" rows={1} />
      ) : materials.isError ? (
        <div className="py-2">
          <ErrorState message={errorMessage(materials.error)} onRetry={() => void materials.refetch()} />
        </div>
      ) : count === 0 ? (
        // One quiet line and not an EmptyState: the step lists every exam, and a tall empty block
        // under each would push the next exam off a phone.
        <p className="py-2 text-small text-ink-muted">{t.empty}</p>
      ) : null}

      {count === 0 ? null : (
        <List aria-label={t.filesOf(exam.name)}>
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
                kindControl={kindControl?.(material)}
                actions={
                  <IconButton aria-label={t.deleteNamed(material.filename)} onPress={() => { remove(material); }}>
                    <Trash2 aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                  </IconButton>
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
                recovery={
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
        </List>
      )}
    </>
  )

  if (bare) {
    return (
      <div className="flex flex-col gap-1">
        <div>{picker}</div>
        {files}
      </div>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      {/* The name of the exam and its one action share a row; a long name wraps under itself. */}
      <div className="flex items-center justify-between gap-3">
        <SectionHeading id={headingId} className="min-w-0 break-words">
          {heading ?? <bdi>{exam.name}</bdi>}
        </SectionHeading>
        <div className="shrink-0">{picker}</div>
      </div>
      {files}
    </section>
  )
}
