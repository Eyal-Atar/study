import { useCallback, useEffect, useRef, useState } from 'react'
import { Button as AriaButton, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { useExams, useMaterials, type Material, type MaterialKind } from '../onboarding/api'
import { ExamMaterials } from '../onboarding/ExamMaterials'
import { useToast } from '../ui/useToast'
import { hasAiTasks, useExamTasks, useUpdateMaterialKind } from './analysis'

const t = he.exam.materials
const KINDS = Object.keys(he.onboardingMaterials.kinds) as MaterialKind[]

export interface MaterialsSectionProps {
  examId: string
}

// The exam's files: the S13 list, upload and delete (ExamMaterials), plus a kind for each file
// (PATCH /materials/{id}). A kind change or a new file does not touch the board; it feeds the next
// analysis (plan decision 8), so an exam that already has AI tasks gets a hint to reanalyze. An exam
// without them shows "בניית תוכנית" below, which reads the files anyway.
export function MaterialsSection({ examId }: MaterialsSectionProps) {
  const exams = useExams()
  const tasks = useExamTasks(examId)
  const materials = useMaterials(examId)
  const updateKind = useUpdateMaterialKind(examId)
  const toast = useToast()
  const [changed, setChanged] = useState(false)
  const analyzed = tasks.isSuccess && hasAiTasks(tasks.data)

  // A file seen while it was still being read, and ready now, is new material for the analysis.
  const reading = useRef(new Set<string>())
  useEffect(() => {
    for (const m of materials.data ?? []) {
      if (m.ingest_status === 'queued' || m.ingest_status === 'processing') reading.current.add(m.id)
      else if (reading.current.delete(m.id) && m.ingest_status === 'ready') setChanged(true)
    }
  }, [materials.data])

  const { mutate } = updateKind
  const changeKind = useCallback(
    (material: Material, kind: MaterialKind) => {
      if (kind === material.kind) return
      mutate(
        { id: material.id, kind },
        {
          onSuccess: () => {
            setChanged(true)
            toast.show({ text: t.kindSaved, tone: 'success' })
          },
          onError: (error) => {
            toast.show({ text: errorMessage(error), tone: 'error' })
          },
        },
      )
    },
    [mutate, toast],
  )

  const exam = exams.data?.find((e) => e.id === examId)
  if (exam === undefined) return null

  return (
    <div className="flex flex-col gap-3">
      <ExamMaterials
        exam={exam}
        heading={t.title}
        onCountChange={ignoreCount}
        kindControl={(material) => (
          <KindSelect
            material={material}
            isDisabled={updateKind.isPending && updateKind.variables.id === material.id}
            onChange={(kind) => {
              changeKind(material, kind)
            }}
          />
        )}
      />
      {changed && analyzed ? (
        <p role="status" className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-ink">
          {t.reanalyzeHint}
        </p>
      ) : null}
    </div>
  )
}

// The onboarding counts files to switch "דלג" to "הבא"; the exam screen has no such button.
function ignoreCount() {
  // Nothing to do.
}

function KindSelect({
  material,
  isDisabled,
  onChange,
}: {
  material: Material
  isDisabled: boolean
  onChange: (kind: MaterialKind) => void
}) {
  return (
    <Select
      aria-label={t.kindLabel(material.filename)}
      value={material.kind}
      onChange={(key) => {
        if (typeof key === 'string' && KINDS.includes(key as MaterialKind)) onChange(key as MaterialKind)
      }}
      isDisabled={isDisabled}
      className="mt-1"
    >
      <AriaButton className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none data-[disabled]:opacity-50 data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[hovered]:bg-surface-muted">
        <SelectValue />
        <span aria-hidden="true" className="text-ink-muted">
          ▾
        </span>
      </AriaButton>
      <Popover className="min-w-(--trigger-width) rounded-lg border border-line bg-surface p-1 shadow-lg outline-none">
        <ListBox className="outline-none">
          {KINDS.map((kind) => (
            <ListBoxItem
              key={kind}
              id={kind}
              textValue={he.onboardingMaterials.kinds[kind]}
              className="flex min-h-11 cursor-default items-center rounded-md px-3 text-sm text-ink outline-none data-[focused]:bg-brand-soft data-[selected]:font-bold"
            >
              {he.onboardingMaterials.kinds[kind]}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  )
}
