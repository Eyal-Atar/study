import { Check, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { he } from '../i18n/he'
import { ListRow } from '../ui/List'
import { Note } from '../ui/Note'
import { cx, ICON_STROKE } from '../ui/styles'
import { splitFileName } from './fileName'
import type { MaterialKind } from './types'

export type MaterialTone = 'muted' | 'success' | 'danger'

const t = he.onboardingMaterials

export interface MaterialItemProps {
  filename: string
  kind: MaterialKind
  // What is happening to the file, already in Hebrew ("מעלה…", "מוכן, 12 עמודים", an error).
  status: string
  tone: MaterialTone
  // Texts of the material's warnings (pages_truncated, text_truncated), shown under the status.
  warnings?: readonly string[]
  // What sits at the end of the row: the delete button of a registered file.
  actions?: ReactNode
  // The ways out of a failed upload ("לנסות שוב", "הסרה"). They sit under the error and not at the
  // end of the row: two text buttons there would leave a phone no room for the name.
  recovery?: ReactNode
  // Replaces the kind's text with a control that changes it (the exam screen, S15). It sits at
  // the end of the row, before `actions`, and the subtitle then starts at the type of the file.
  kindControl?: ReactNode
}

// One file of an exam: a pending upload, or a registered material. The parent decides the status and the
// actions; this row only lays them out.
// The name is shown without its extension, and the type moves to the subtitle: "מבחן עבר, PDF. מוכן,
// 24 עמודים" (fileName.ts says why). The accessible names of the buttons keep the full name.
export function MaterialItem({ filename, kind, status, tone, warnings = [], actions, recovery, kindControl }: MaterialItemProps) {
  const { name, type } = splitFileName(filename)
  const lead = t.fileLead(kindControl === undefined ? t.kinds[kind] : null, type)
  // The state is never colour alone: a failure has an icon and its reason in words, and "ready"
  // says so; its check only helps the eye run down a long list.
  const StatusIcon = tone === 'danger' ? CircleAlert : tone === 'success' ? Check : null
  return (
    <ListRow
      // A file name can be in any language: <bdi> isolates its direction, while the line itself stays
      // aligned with the rest of the (RTL) row. A long name without spaces breaks (the row's title).
      title={<bdi>{name}</bdi>}
      subtitle={
        <>
          <p className="tabular-nums">
            {lead === '' ? null : <span>{lead} </span>}
            <span className={cx(tone === 'danger' && 'text-danger')}>
              {StatusIcon === null ? null : (
                <StatusIcon
                  aria-hidden="true"
                  size={14}
                  strokeWidth={ICON_STROKE}
                  className={cx('me-1 inline-block align-[-0.125em]', tone === 'success' && 'text-success')}
                />
              )}
              {status}
            </span>
          </p>
          {warnings.map((warning) => (
            <Note key={warning} tone="warning" className="mt-2">
              {warning}
            </Note>
          ))}
          {/* -ms-4: a quiet button has no border, so its text lines up with the text above it. */}
          {recovery === undefined ? null : <div className="-ms-4 mt-1 flex flex-wrap gap-1">{recovery}</div>}
        </>
      }
      trailing={
        kindControl === undefined && actions === undefined ? undefined : (
          <>
            {kindControl}
            {actions}
          </>
        )
      }
    />
  )
}
