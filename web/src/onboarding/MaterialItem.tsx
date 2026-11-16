import type { ReactNode } from 'react'
import { he } from '../i18n/he'
import type { MaterialKind } from './types'

export type MaterialTone = 'muted' | 'success' | 'danger'

const TONES: Record<MaterialTone, string> = {
  muted: 'text-ink-muted',
  success: 'text-success',
  danger: 'text-danger',
}

export interface MaterialItemProps {
  filename: string
  kind: MaterialKind
  // What is happening to the file, already in Hebrew ("מעלה…", "מוכן, 12 עמודים", an error).
  status: string
  tone: MaterialTone
  // Texts of the material's warnings (pages_truncated, text_truncated), shown under the status.
  warnings?: readonly string[]
  // The row's buttons. They wrap under the name when the row is too narrow (a phone at 375px).
  actions?: ReactNode
  // Replaces the kind's text with a control that changes it (the exam screen, S15).
  kindControl?: ReactNode
}

// One file of an exam: a pending upload, or a registered material. The parent decides the status and the
// actions; this row only lays them out.
export function MaterialItem({ filename, kind, status, tone, warnings = [], actions, kindControl }: MaterialItemProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        {/* A file name can be in any language: <bdi> isolates its direction, while the line itself
            stays aligned with the rest of the (RTL) row. */}
        <p className="truncate text-start text-sm font-medium text-ink">
          <bdi>{filename}</bdi>
        </p>
        {kindControl ?? <p className="text-xs text-ink-muted">{he.onboardingMaterials.kinds[kind]}</p>}
        <p className={`mt-1 text-sm ${TONES[tone]}`}>{status}</p>
        {warnings.map((warning) => (
          <p key={warning} className="mt-2 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">
            {warning}
          </p>
        ))}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 flex-wrap gap-1">{actions}</div>}
    </li>
  )
}
