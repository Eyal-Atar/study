import { Briefcase, GraduationCap, Moon, MoreHorizontal, Sun, Sunrise, Sunset } from 'lucide-react'
import { useState } from 'react'
import { ExamChip, ExamInitial, ExamProgressBar } from '../ui/ExamMark'
import { EXAM_COLOR_COUNT } from '../ui/examColor'
import { IconButton } from '../ui/IconButton'
import { IconChoiceCards } from '../ui/IconChoiceCards'
import { InkButton } from '../ui/InkButton'
import { Stepper } from '../ui/Stepper'
import { ICON_STROKE } from '../ui/styles'
import { TileList, TileRow } from '../ui/TileList'
import { devText } from './devText'
import { Example, FIELD_GRID, ROW, Section } from './Section'

// The components S34 added to ui/, each in every state. Their texts are in the s34 section of
// devText.ts.
const t = devText.s34

export function TileListSection() {
  const [pressed, setPressed] = useState<string>(t.tileList.nothing)
  return (
    <Section id="tile-list">
      <Example caption={t.tileList.plain}>
        <TileList aria-label={t.tileList.fixedLabel}>
          <TileRow title={t.tileList.work} />
          <TileRow
            title={t.tileList.lecture}
            subtitle={
              <>
                {t.tileList.lectureWhen}
                <span dir="ltr">{t.tileList.lectureHours}</span>
              </>
            }
          />
        </TileList>
      </Example>
      <Example caption={t.tileList.link}>
        <TileList aria-label={t.tileList.label}>
          {t.tileList.exams.map((exam) => (
            <TileRow
              key={exam.id}
              to="/dev/components#tile-list"
              leading={<ExamInitial name={exam.name} colorIndex={exam.color} />}
              title={exam.name}
              subtitle={exam.done === 0 ? `${exam.date}, ${t.tileList.noTasks}` : `${exam.date}, ${t.tileList.ofPlan(exam.done)}`}
              footer={
                <ExamProgressBar
                  colorIndex={exam.color}
                  value={exam.done}
                  max={exam.done === 0 ? 0 : 100}
                  aria-label={t.tileList.progress(exam.name)}
                  valueText={exam.done === 0 ? t.tileList.noTasks : t.tileList.ofPlan(exam.done)}
                />
              }
              trailing={<ExamChip colorIndex={exam.color}>{exam.days}</ExamChip>}
            />
          ))}
        </TileList>
      </Example>
      <Example caption={t.tileList.button}>
        <TileList aria-label={t.tileList.fixedLabel}>
          <TileRow
            leading={<Briefcase aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="text-ink-muted" />}
            title={t.tileList.work}
            subtitle={
              <>
                {t.tileList.workWhen}
                <span dir="ltr">{t.tileList.workHours}</span>
              </>
            }
            onPress={() => {
              setPressed(t.tileList.work)
            }}
            trailing={
              <IconButton aria-label={t.tileList.actions(t.tileList.work)}>
                <MoreHorizontal aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </IconButton>
            }
          />
          <TileRow
            leading={<GraduationCap aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="text-ink-muted" />}
            title={t.tileList.lecture}
            subtitle={
              <>
                {t.tileList.lectureWhen}
                <span dir="ltr">{t.tileList.lectureHours}</span>
              </>
            }
            onPress={() => {
              setPressed(t.tileList.lecture)
            }}
          />
        </TileList>
        <p className="text-small text-ink-muted">
          {t.tileList.pressed} {pressed}
        </p>
      </Example>
    </Section>
  )
}

function DemoStepper({ initial, withDescription }: { initial: number; withDescription?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <Stepper
      label={t.stepper.label}
      caption={t.stepper.caption}
      description={withDescription === true ? t.stepper.description : undefined}
      value={value}
      options={t.stepper.hours}
      onChange={setValue}
    />
  )
}

export function StepperSection() {
  return (
    <Section id="stepper">
      <div className={FIELD_GRID}>
        <Example caption={t.stepper.middle}>
          <DemoStepper initial={240} />
        </Example>
        <Example caption={t.stepper.top}>
          <DemoStepper initial={360} />
        </Example>
        <Example caption={t.stepper.bottom}>
          <DemoStepper initial={60} withDescription />
        </Example>
      </div>
    </Section>
  )
}

const WINDOWS = [
  { value: 'morning', label: t.iconChoice.morning, description: t.iconChoice.morningRange, icon: Sunrise },
  { value: 'noon', label: t.iconChoice.noon, description: t.iconChoice.noonRange, icon: Sun },
  { value: 'evening', label: t.iconChoice.evening, description: t.iconChoice.eveningRange, icon: Sunset },
  { value: 'night', label: t.iconChoice.night, description: t.iconChoice.nightRange, icon: Moon },
] as const

function DemoIconChoice({ initial, withError }: { initial: string[]; withError?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <IconChoiceCards
      label={t.iconChoice.label}
      options={WINDOWS}
      value={value}
      onChange={setValue}
      errorMessage={withError === true && value.length === 0 ? t.iconChoice.error : undefined}
    />
  )
}

export function IconChoiceCardsSection() {
  return (
    <Section id="icon-choice-cards">
      <div className={FIELD_GRID}>
        <Example caption={t.iconChoice.some}>
          <DemoIconChoice initial={['morning', 'evening']} />
        </Example>
        <Example caption={t.iconChoice.none}>
          <DemoIconChoice initial={[]} withError />
        </Example>
      </div>
    </Section>
  )
}

const INDEXES = Array.from({ length: EXAM_COLOR_COUNT }, (_, index) => index)

export function ExamMarkSection() {
  return (
    <Section id="exam-mark">
      <Example caption={t.examMark.initials}>
        <div className={ROW}>
          {INDEXES.map((index) => (
            <ExamInitial key={index} name={t.examMark.names[index] ?? ''} colorIndex={index} />
          ))}
          <ExamInitial name={t.examMark.names[0]} colorIndex={0} size="lg" />
        </div>
      </Example>
      <Example caption={t.examMark.bars}>
        <div className="flex max-w-xs flex-col gap-3">
          {[0, 42, 100].map((percent, index) => (
            <ExamProgressBar
              key={percent}
              colorIndex={index + 1}
              value={percent}
              max={100}
              aria-label={`${t.examMark.progress}: ${t.examMark.names[index + 1] ?? ''}`}
              valueText={`${String(percent)}%`}
            />
          ))}
        </div>
      </Example>
      <Example caption={t.examMark.chips}>
        <div className={ROW}>
          {INDEXES.map((index) => (
            <ExamChip key={index} colorIndex={index}>
              {t.examMark.days(22 + index * 5)}
            </ExamChip>
          ))}
        </div>
      </Example>
    </Section>
  )
}

export function InkButtonSection() {
  return (
    <Section id="ink-button">
      <div className={FIELD_GRID}>
        <Example caption={t.inkButton.rest}>
          <div className={ROW}>
            <InkButton className="w-full">{t.inkButton.google}</InkButton>
            <InkButton>{t.inkButton.addExam}</InkButton>
          </div>
        </Example>
        <Example caption={t.inkButton.pending}>
          <InkButton isPending className="w-full">
            {t.inkButton.google}
          </InkButton>
        </Example>
        <Example caption={t.inkButton.disabled}>
          <InkButton isDisabled>{t.inkButton.addExam}</InkButton>
        </Example>
      </div>
    </Section>
  )
}

// All the S34 sections in their order, so the page adds them in one line.
export function S34Sections() {
  return (
    <>
      <TileListSection />
      <StepperSection />
      <IconChoiceCardsSection />
      <ExamMarkSection />
      <InkButtonSection />
    </>
  )
}
