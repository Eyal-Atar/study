import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { useExams, useMaterials, type Material, type MaterialKind } from '../onboarding/api'
import { ExamMaterials } from '../onboarding/ExamMaterials'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import { CompactSelect } from '../ui/CompactSelect'
import { Note } from '../ui/Note'
import { useToast } from '../ui/useToast'
import { hasAiTasks, useExamTasks, useUpdateMaterialKind } from './analysis'

const t = he.exam.materials
const KINDS = Object.keys(he.onboardingMaterials.kinds) as MaterialKind[]
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind, label: he.onboardingMaterials.kinds[kind] }))

export interface MaterialsSectionProps {
  examId: string
}

// The exam's files: the S13 list, upload and delete (ExamMaterials), plus a kind for each file
// (PATCH /materials/{id}). A kind change or a new file does not touch the board; it feeds the next
// analysis (plan decision 8), so an exam that already has AI tasks gets a hint to reanalyze. An exam
// without them shows "בניית תוכנית" below, which reads the files anyway.
//
// The section is collapsible (S28 decision 2): for an exam that already has a plan the files are
// secondary, so it is closed, with the number of files in its heading. For an exam that was not
// analyzed yet the files are the next thing to do, so it is open. Once the user opens or closes
// it, their choice stays.
export function MaterialsSection({ examId }: MaterialsSectionProps) {
  const exams = useExams()
  const tasks = useExamTasks(examId)
  const materials = useMaterials(examId)
  const updateKind = useUpdateMaterialKind(examId)
  const toast = useToast()
  const [changed, setChanged] = useState(false)
  const analyzed = tasks.isSuccess && hasAiTasks(tasks.data)
  const [userChoice, setUserChoice] = useState<boolean | null>(null)
  // Closed until the tasks say whether the exam was analyzed: an analyzed exam (the common case)
  // then never opens and shuts by itself.
  const isExpanded = userChoice ?? (!tasks.isPending && !analyzed)
  // The files on screen, uploads on their way included, as ExamMaterials reports them.
  const [count, setCount] = useState(0)
  const onCountChange = useCallback((_examId: string, files: number) => {
    setCount(files)
  }, [])

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

  const section = (
    <CollapsibleSection
      title={t.title}
      summary={materials.isSuccess ? t.count(count) : undefined}
      isExpanded={isExpanded}
      onExpandedChange={setUserChoice}
    >
      <div className="flex flex-col gap-3">
        <ExamMaterials
          bare
          exam={exam}
          heading={t.title}
          onCountChange={onCountChange}
          kindControl={(material) => (
            <CompactSelect
              aria-label={t.kindLabel(material.filename)}
              value={material.kind}
              options={KIND_OPTIONS}
              isDisabled={updateKind.isPending && updateKind.variables.id === material.id}
              onChange={(kind) => {
                if (KINDS.includes(kind as MaterialKind)) changeKind(material, kind as MaterialKind)
              }}
            />
          )}
        />
      </div>
    </CollapsibleSection>
  )
  // The hint sits outside the section: a file that finished being read while the section was
  // closed must not change the next analysis without the user seeing it.
  return (
    <>
      {section}
      {changed && analyzed ? (
        <div className="mb-4">
          <Note role="status">{t.reanalyzeHint}</Note>
        </div>
      ) : null}
    </>
  )
}
