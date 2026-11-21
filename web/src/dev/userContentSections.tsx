import { UserText } from '../ui/UserText'
import { devText } from './devText'
import { sample } from './sampleContent'
import { Example, FIELD_GRID, Section } from './Section'

const t = devText

// The three samples of every mode: Hebrew, English and a mix of both.
const SAMPLES = [
  { key: 'hebrew', label: t.userContent.hebrew, text: sample.hebrew, paragraph: sample.paragraphHebrew },
  { key: 'english', label: t.userContent.english, text: sample.english, paragraph: sample.paragraphEnglish },
  { key: 'mixed', label: t.userContent.mixed, text: sample.mixed, paragraph: sample.paragraphHebrew },
] as const

// UserText in its three modes. The interface is English and left to right; this text is the
// student's own, so it takes its own direction, and a long one is cut at the end of the text.
export function UserContentSection() {
  return (
    <Section id="user-content">
      <p className="text-small text-ink-muted">{t.userContent.caption}</p>
      <div className={FIELD_GRID}>
        <Example caption={t.userContent.inline}>
          <ul role="list" className="space-y-1 text-body">
            {SAMPLES.map(({ key, label, text }) => (
              <li key={key} data-sample={key}>
                {label}: {t.userContent.sentenceBefore}
                <UserText>{text}</UserText>
                {t.userContent.sentenceAfter}
              </li>
            ))}
            <li data-sample="brackets">
              {t.userContent.sentenceBefore}
              <UserText>{sample.examWithBrackets}</UserText>
              {t.userContent.sentenceAfter}
            </li>
          </ul>
        </Example>
        <Example caption={t.userContent.truncate} className="max-w-xs">
          <ul role="list" className="space-y-1 text-body">
            <li>
              <UserText truncate>{sample.longExamName}</UserText>
            </li>
            <li>
              <UserText truncate>{sample.english.repeat(4)}</UserText>
            </li>
          </ul>
        </Example>
        <Example caption={t.userContent.prose} className="md:col-span-2">
          <div className="max-w-prose space-y-2 text-body">
            {SAMPLES.map(({ key, paragraph }) => (
              <UserText key={key} prose>
                {paragraph}
              </UserText>
            ))}
          </div>
        </Example>
      </div>
    </Section>
  )
}
