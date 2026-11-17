import { useState } from 'react'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import { CompactSelect } from '../ui/CompactSelect'
import { Switch } from '../ui/Switch'
import { Example, FIELD_GRID, Section } from './Section'

// The components S28 added (Switch, CompactSelect, CollapsibleSection; Note came from S27). Their texts are here
// and not in devText.ts, so the two scopes that run side by side add to different files; like
// devText.ts, this module is reached only through the import() of the dev route.
const t = {
  switch: {
    off: 'כבוי',
    on: 'פועל, עם תיאור',
    disabled: 'לא זמין: אפור, בלי שקיפות',
    label: 'זמן לעצמי כל יום',
    description: 'זמן קבוע ביום שבו לא נשבץ לימוד.',
  },
  compactSelect: {
    chosen: 'בתוך שורה: רחב כמו הערך שלו, בלי תווית גלויה',
    disabled: 'לא זמין',
    label: 'סוג הקובץ סילבוס.pdf',
    kinds: [
      { value: 'syllabus', label: 'סילבוס' },
      { value: 'summary', label: 'סיכום' },
      { value: 'past_exam', label: 'מבחן עבר' },
      { value: 'solution', label: 'פתרון' },
      { value: 'notes', label: 'הערות' },
      { value: 'other', label: 'אחר' },
    ],
  },
  collapsible: {
    closed: 'סגור, עם שורת סיכום',
    open: 'פתוח',
    materials: 'חומרים',
    materialsSummary: '3 קבצים',
    analysis: 'ניתוח החומרים',
    body: 'התוכן של הקטע: רשימה, טופס או כל דבר אחר.',
  },
}

function DemoSwitch({ initial, description, isDisabled }: { initial: boolean; description?: string; isDisabled?: boolean }) {
  const [on, setOn] = useState(initial)
  return <Switch label={t.switch.label} description={description} isSelected={on} onChange={setOn} isDisabled={isDisabled} />
}

export function SwitchSection() {
  return (
    <Section id="switch">
      <div className={FIELD_GRID}>
        <Example caption={t.switch.off}>
          <DemoSwitch initial={false} />
        </Example>
        <Example caption={t.switch.on}>
          <DemoSwitch initial description={t.switch.description} />
        </Example>
        <Example caption={t.switch.disabled}>
          <DemoSwitch initial={false} isDisabled />
        </Example>
        <Example caption={t.switch.disabled}>
          <DemoSwitch initial isDisabled />
        </Example>
      </div>
    </Section>
  )
}

function DemoCompactSelect({ isDisabled }: { isDisabled?: boolean }) {
  const [value, setValue] = useState('syllabus')
  return (
    <CompactSelect
      aria-label={t.compactSelect.label}
      value={value}
      options={t.compactSelect.kinds}
      onChange={setValue}
      isDisabled={isDisabled}
    />
  )
}

export function CompactSelectSection() {
  return (
    <Section id="compact-select">
      <div className={FIELD_GRID}>
        <Example caption={t.compactSelect.chosen}>
          <DemoCompactSelect />
        </Example>
        <Example caption={t.compactSelect.disabled}>
          <DemoCompactSelect isDisabled />
        </Example>
      </div>
    </Section>
  )
}

function DemoCollapsible({ initial, title, summary }: { initial: boolean; title: string; summary?: string }) {
  const [open, setOpen] = useState(initial)
  return (
    // level 3: on this page every h2 is the heading of a catalogue section.
    <CollapsibleSection title={title} summary={summary} level={3} isExpanded={open} onExpandedChange={setOpen}>
      <p className="text-body text-ink">{t.collapsible.body}</p>
    </CollapsibleSection>
  )
}

export function CollapsibleSectionSection() {
  return (
    <Section id="collapsible-section">
      <Example caption={t.collapsible.closed}>
        <DemoCollapsible initial={false} title={t.collapsible.materials} summary={t.collapsible.materialsSummary} />
      </Example>
      <Example caption={t.collapsible.open}>
        <DemoCollapsible initial title={t.collapsible.analysis} />
      </Example>
    </Section>
  )
}
