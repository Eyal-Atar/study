import { useState } from 'react'
import type { ArchieMood } from '../archie/moods'
import { CommitmentDialog, type CommitmentDraft } from '../commitments/CommitmentDialog'
import { paintedRanges, type CommitmentGroup } from '../commitments/model'
import {
  TimetableFailure,
  TimetableProgress,
  TimetableProposals,
  TimetableUploadTrigger,
  type ProposalRow,
} from '../commitments/TimetableImport'
import { WeekPainter } from '../commitments/WeekPainter'
import { en } from '../i18n/en'
import { isolate } from '../i18n/bidi'
import { FeasibilityNote, type FeasibilityEstimate } from '../onboarding/FeasibilityNote'
import { ArchiLead } from '../ui/ArchiLead'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ExamChip, ExamInitial, ExamProgressBar } from '../ui/ExamMark'
import { EXAM_COLOR_COUNT } from '../ui/examColor'
import { IconButton } from '../ui/IconButton'
import { IconChoiceCards } from '../ui/IconChoiceCards'
import { InkButton } from '../ui/InkButton'
import { RecapLine } from '../ui/RecapLine'
import { Stepper } from '../ui/Stepper'
import { ClassIcon, Ellipsis, EveningIcon, MorningIcon, NightIcon, NoonIcon, WorkIcon } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'
import { TileList, TileRow } from '../ui/TileList'
import { WeekdayPicker } from '../ui/WeekdayPicker'
import { UserText } from '../ui/UserText'
import { devText } from './devText'
import { Example, FIELD_GRID, ROW, Section } from './Section'
import { sample } from './sampleContent'

// The components S34 added to ui/, each in every state. Their texts are in the s34 section of
// devText.ts.
const t = devText.s34

// The user content of the examples: the exam names, and the titles of two fixed commitments.
const EXAM_NAMES = [sample.exams[0], sample.exams[1]] as const
const WORK = sample.busyTitle
const LECTURE = sample.lectureTitle

export function TileListSection() {
  const [pressed, setPressed] = useState<string>(t.tileList.nothing)
  return (
    <Section id="tile-list">
      <Example caption={t.tileList.plain}>
        <TileList aria-label={t.tileList.fixedLabel}>
          <TileRow title={<UserText>{WORK}</UserText>} />
          <TileRow
            title={<UserText>{LECTURE}</UserText>}
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
          {t.tileList.exams.map((exam, index) => {
          const name = EXAM_NAMES[index] ?? ''
          return (
            <TileRow
              key={exam.id}
              to="/dev/components#tile-list"
              leading={<ExamInitial name={name} colorIndex={exam.color} />}
              title={<UserText>{name}</UserText>}
              subtitle={exam.done === 0 ? `${exam.date}, ${t.tileList.noTasks}` : `${exam.date}, ${t.tileList.ofPlan(exam.done)}`}
              footer={
                <ExamProgressBar
                  colorIndex={exam.color}
                  value={exam.done}
                  max={exam.done === 0 ? 0 : 100}
                  aria-label={`${t.tileList.progress}: ${isolate(name)}`}
                  valueText={exam.done === 0 ? t.tileList.noTasks : t.tileList.ofPlan(exam.done)}
                />
              }
              trailing={<ExamChip colorIndex={exam.color}>{exam.days}</ExamChip>}
            />
          )
        })}
        </TileList>
      </Example>
      <Example caption={t.tileList.button}>
        <TileList aria-label={t.tileList.fixedLabel}>
          <TileRow
            leading={<WorkIcon aria-hidden="true" size={18} className="text-ink-muted" />}
            title={<UserText>{WORK}</UserText>}
            subtitle={
              <>
                {t.tileList.workWhen}
                <span dir="ltr">{t.tileList.workHours}</span>
              </>
            }
            onPress={() => {
              setPressed(WORK)
            }}
            trailing={
              <IconButton aria-label={`${t.tileList.actionsFor} ${isolate(WORK)}`}>
                <Ellipsis aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </IconButton>
            }
          />
          <TileRow
            leading={<ClassIcon aria-hidden="true" size={18} className="text-ink-muted" />}
            title={<UserText>{LECTURE}</UserText>}
            subtitle={
              <>
                {t.tileList.lectureWhen}
                <span dir="ltr">{t.tileList.lectureHours}</span>
              </>
            }
            onPress={() => {
              setPressed(LECTURE)
            }}
          />
        </TileList>
        <p className="text-small text-ink-muted">
          {t.tileList.pressed} <UserText>{pressed}</UserText>
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
  { value: 'morning', label: t.iconChoice.morning, description: t.iconChoice.morningRange, icon: MorningIcon },
  { value: 'noon', label: t.iconChoice.noon, description: t.iconChoice.noonRange, icon: NoonIcon },
  { value: 'evening', label: t.iconChoice.evening, description: t.iconChoice.eveningRange, icon: EveningIcon },
  { value: 'night', label: t.iconChoice.night, description: t.iconChoice.nightRange, icon: NightIcon },
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
            <ExamInitial key={index} name={sample.exams[index] ?? ''} colorIndex={index} />
          ))}
          <ExamInitial name={sample.exams[0]} colorIndex={0} size="lg" />
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
              aria-label={`${t.examMark.progress}: ${isolate(sample.exams[index + 1] ?? '')}`}
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

// A phone-wide column, as the lead stands in the onboarding.
const PHONE = 'max-w-sm'

// The six moods in the order the conversation meets them: the four steps, the ready plan, rest.
const LEAD_MOODS: ArchieMood[] = ['joy', 'wisdom', 'intentions', 'flow', 'eureka', 'rest']

// The three levels of the live feedback, for the exams of the sample.
const ESTIMATES: FeasibilityEstimate[] = [
  { level: 'roomy', firstExamName: sample.exams[0], firstExamMinutes: 88 * 60 },
  { level: 'tight', firstExamName: sample.exams[0], firstExamMinutes: 14 * 60, tightExamName: sample.exams[2], tightExamMinutes: 6 * 60 },
  { level: 'none', firstExamName: sample.exams[0], firstExamMinutes: 0 },
]

export function ArchiLeadSection() {
  const lead = t.archiLead
  return (
    <Section id="archi-lead">
      <p className="text-small text-ink-muted">{lead.caption}</p>
      <div className={FIELD_GRID}>
        {LEAD_MOODS.map((mood) => {
          const example: { caption: string; question: string; context?: string; below?: string } = lead.moods[mood]
          return (
            <Example key={mood} caption={example.caption} className={PHONE}>
              {/* level 3: on this page every h2 is the heading of a catalogue section. */}
              <ArchiLead mood={mood} question={example.question} context={example.context} below={example.below} headingLevel={3} />
              {/* With no paragraph below, the answer card is what he stands on. */}
              <Card className={example.below === undefined ? undefined : 'mt-1'}>
                <p className="text-small text-ink-muted">{lead.answer}</p>
              </Card>
            </Example>
          )
        })}
        <Example caption={lead.long} className={PHONE}>
          <ArchiLead mood="wisdom" question={lead.longQuestion} headingLevel={3} />
        </Example>
      </div>
      <Example caption={lead.feasibility} className={PHONE}>
        <div className="flex flex-col gap-2">
          {ESTIMATES.map((estimate) => (
            <FeasibilityNote key={estimate.level} estimate={estimate} />
          ))}
        </div>
      </Example>
      <Example caption={lead.feasibilityEmpty} className={PHONE}>
        <FeasibilityNote estimate={null} />
      </Example>
    </Section>
  )
}

export function RecapLineSection() {
  const recap = t.recapLine
  const names = [sample.exams[0], sample.exams[1], sample.exams[2]]
  return (
    <Section id="recap-line">
      <div className={FIELD_GRID}>
        <Example caption={recap.caption} className={PHONE}>
          <RecapLine label={recap.count(names.length)} value={names.join(recap.separator)} />
        </Example>
        <Example caption={recap.plain} className={PHONE}>
          <RecapLine label={recap.plainText} />
        </Example>
        <Example caption={recap.long} className={PHONE}>
          <RecapLine label={recap.count(sample.exams.length)} value={sample.exams.join(recap.separator)} />
        </Example>
        <Example caption={recap.longName} className={PHONE}>
          <RecapLine label={recap.count(1)} value={sample.longExamName} />
        </Example>
      </div>
    </Section>
  )
}

// The week painter with its state held here, as the onboarding holds it, and the runs it makes
// read back below it as the commitments they would become.
function DemoWeekPainter({ firstHour, lastHour, initial, saved }: { firstHour: number; lastHour: number; initial: string[]; saved: string[] }) {
  const [painted, setPainted] = useState<ReadonlySet<string>>(() => new Set(initial))
  const [savedCells] = useState<ReadonlySet<string>>(() => new Set(saved))
  const runs = paintedRanges(painted, firstHour).map((r) => `${en.commitments.weekdayShort[r.weekday]} ${r.start_time}–${r.end_time}`)
  return (
    <div className="flex flex-col gap-2">
      <WeekPainter firstHour={firstHour} lastHour={lastHour} painted={painted} saved={savedCells} onChange={setPainted} />
      <p className="text-small text-ink-muted tabular-nums">
        {t.weekPainter.marked} {runs.length > 0 ? runs.join(', ') : t.weekPainter.nothing}
      </p>
    </div>
  )
}

export function WeekPainterSection() {
  return (
    <Section id="week-painter">
      <div className={FIELD_GRID}>
        <Example caption={t.weekPainter.caption} className={PHONE}>
          <DemoWeekPainter firstHour={8} lastHour={23} initial={['2-14', '2-15', '2-16']} saved={['0-10', '0-11', '1-16', '1-17']} />
        </Example>
        <Example caption={t.weekPainter.late} className={PHONE}>
          <DemoWeekPainter firstHour={18} lastHour={26} initial={['4-23', '4-0']} saved={[]} />
        </Example>
      </div>
    </Section>
  )
}

export function WeekdayPickerSection() {
  const [days, setDays] = useState<string[]>(['1', '2', '3'])
  const [none, setNone] = useState<string[]>([])
  const w = t.weekdayPicker
  return (
    <Section id="weekday-picker">
      <div className={FIELD_GRID}>
        <Example caption={w.caption} className={PHONE}>
          <WeekdayPicker label={w.label} value={days} onChange={setDays} />
          <p className="text-small text-ink-muted tabular-nums">
            {w.chosen} {days.length > 0 ? days.map((d) => en.commitments.weekdayShort[Number(d)]).join(', ') : w.nothing}
          </p>
        </Example>
        <Example caption={w.error} className={PHONE}>
          <WeekdayPicker label={w.label} value={none} onChange={setNone} errorMessage={w.errorText} />
        </Example>
      </div>
    </Section>
  )
}

const SAMPLE_GROUP: CommitmentGroup = {
  key: 'sample',
  title: WORK,
  kind: 'work',
  weekdays: [1, 2, 3],
  start_time: '09:00',
  end_time: '17:00',
  valid_from: '2026-11-01',
  valid_until: null,
  ids: ['a', 'b', 'c'],
  isMeTime: false,
}

export function CommitmentDialogSection() {
  const [open, setOpen] = useState<'add' | 'edit' | null>(null)
  const [draft, setDraft] = useState<CommitmentDraft | null>(null)
  return (
    <Section id="commitment-dialog">
      <Example caption={t.commitmentDialog.caption} className={PHONE}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onPress={() => {
              setOpen('add')
            }}
          >
            {t.commitmentDialog.add}
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              setOpen('edit')
            }}
          >
            {t.commitmentDialog.edit}
          </Button>
        </div>
        <p className="text-small text-ink-muted tabular-nums">
          {t.commitmentDialog.draft}{' '}
          {draft === null ? (
            t.commitmentDialog.nothing
          ) : (
            <>
              <UserText>{draft.title}</UserText>, {draft.weekdays.map((d) => en.commitments.weekdayShort[d]).join(', ')}, {draft.start_time}–{draft.end_time}
            </>
          )}
        </p>
      </Example>
      <CommitmentDialog
        isOpen={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
        group={open === 'edit' ? SAMPLE_GROUP : null}
        mode="draft"
        onDraft={setDraft}
        onSaved={() => undefined}
      />
    </Section>
  )
}

const SAMPLE_PROPOSALS: ProposalRow[] = [
  { key: 'work', title: WORK, kind: 'work', weekdays: [0, 2], start_time: '14:00', end_time: '17:00', valid_until: null, approved: true },
  { key: 'lecture', title: LECTURE, kind: 'class', weekdays: [3], start_time: '10:00', end_time: '12:00', valid_until: null, approved: true },
]

// Each step of the photo flow on its own, with the parts TimetableImport is made of: nothing is
// uploaded, read or saved here.
export function TimetableImportSection() {
  const [chosen, setChosen] = useState<string | null>(null)
  const [rows, setRows] = useState<ProposalRow[]>(SAMPLE_PROPOSALS)
  const [until, setUntil] = useState('')
  const text = t.timetableImport
  const timetable = en.commitments.timetable
  return (
    <Section id="timetable-import">
      <div className={FIELD_GRID}>
        <Example caption={text.button} className={PHONE}>
          <div className="flex flex-col gap-3">
            <TimetableUploadTrigger
              variant="onboarding"
              onSelect={(file) => {
                setChosen(file.name)
              }}
            />
            <TimetableUploadTrigger
              variant="row"
              onSelect={(file) => {
                setChosen(file.name)
              }}
            />
            <p className="text-small text-ink-muted">
              {text.chosen} {chosen === null ? text.nothing : <UserText>{chosen}</UserText>}
            </p>
          </div>
        </Example>
        <Example caption={text.progress} className={PHONE}>
          <div className="flex flex-col gap-2">
            <TimetableProgress text={timetable.preparing} />
            <TimetableProgress text={timetable.reading} />
          </div>
        </Example>
        <Example caption={text.proposals} className={PHONE}>
          <TimetableProposals
            rows={rows}
            onRowsChange={setRows}
            validUntil={until}
            onValidUntilChange={setUntil}
            onApply={() => undefined}
            onCancel={() => {
              setRows(SAMPLE_PROPOSALS)
              setUntil('')
            }}
            note={null}
          />
        </Example>
        <Example caption={text.failure} className={PHONE}>
          <TimetableFailure text={en.codes.unsupported_file} />
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
      <ArchiLeadSection />
      <RecapLineSection />
      <WeekPainterSection />
      <WeekdayPickerSection />
      <CommitmentDialogSection />
      <TimetableImportSection />
    </>
  )
}
