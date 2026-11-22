import { useState } from 'react'
import { ActionCard } from '../ui/ActionCard'
import { BlockCheck } from '../ui/BlockCheck'
import { FreeTimeIcon } from '../ui/icons'
import { ProgressRing } from '../ui/ProgressRing'
import { devText } from './devText'
import { Example, FIELD_GRID, ROW, Section } from './Section'

// The components S32 added for the calendar: BlockCheck, ProgressRing and ActionCard. Their texts
// are in devText.s32.
const t = devText.s32

function DemoCheck({ initial, isDisabled }: { initial: boolean; isDisabled?: boolean }) {
  const [done, setDone] = useState(initial)
  return <BlockCheck isDone={done} onChange={setDone} aria-label={t.checkLabel} isDisabled={isDisabled} />
}

export function BlockCheckSection() {
  return (
    <Section id="block-check">
      <div className={FIELD_GRID}>
        <Example caption={t.check.empty}>
          <DemoCheck initial={false} />
        </Example>
        <Example caption={t.check.done}>
          <DemoCheck initial />
        </Example>
        <Example caption={t.check.disabled}>
          <DemoCheck initial={false} isDisabled />
        </Example>
      </div>
    </Section>
  )
}

export function ProgressRingSection() {
  return (
    <Section id="progress-ring">
      <div className={ROW}>
        <Example caption={t.ring.none}>
          <ProgressRing value={0} max={285} aria-label={t.ringLabel} valueText={t.ringText(0)} />
        </Example>
        <Example caption={t.ring.some}>
          <ProgressRing value={90} max={285} aria-label={t.ringLabel} valueText={t.ringText(90)} />
        </Example>
        <Example caption={t.ring.full}>
          <ProgressRing value={285} max={285} aria-label={t.ringLabel} valueText={t.ringText(285)} />
        </Example>
      </div>
    </Section>
  )
}

export function ActionCardSection() {
  return (
    <Section id="action-card">
      <div className={FIELD_GRID}>
        <Example caption={t.card.plain}>
          <ActionCard icon={FreeTimeIcon} title={t.card.title} onPress={() => undefined} />
        </Example>
        <Example caption={t.card.described}>
          <ActionCard icon={FreeTimeIcon} title={t.card.title} description={t.card.description} onPress={() => undefined} />
        </Example>
        <Example caption={t.card.pending}>
          <ActionCard icon={FreeTimeIcon} title={t.card.title} description={t.card.description} onPress={() => undefined} isPending />
        </Example>
        <Example caption={t.card.disabled}>
          <ActionCard icon={FreeTimeIcon} title={t.card.title} description={t.card.description} onPress={() => undefined} isDisabled />
        </Example>
      </div>
    </Section>
  )
}
