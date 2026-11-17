import { CalendarOff, Check, EllipsisVertical, FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { he } from '../i18n/he'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Disclosure } from '../ui/Disclosure'
import { IconButton } from '../ui/IconButton'
import { List, ListRow } from '../ui/List'
import { Menu, MenuItem } from '../ui/Menu'
import { ProgressBar } from '../ui/ProgressBar'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { cx, ICON_STROKE } from '../ui/styles'
import { TextLink } from '../ui/TextLink'
import { useToast } from '../ui/useToast'
import { devText } from './devText'
import { Example, ROW, Section } from './Section'

const t = devText

// The path of this page: the row that is a link stays here.
const SELF_PATH = '/dev/components'

export function CardSection() {
  return (
    <Section id="card">
      <div className="grid gap-4 md:grid-cols-2">
        <Example caption={t.card.plain}>
          <Card>
            <p className="text-small font-semibold text-brand-strong">{t.card.plainTitle}</p>
            <p className="mt-1 text-body">{t.card.plainText}</p>
          </Card>
        </Example>
        <Example caption={t.card.danger}>
          <Card tone="danger">
            <p className="text-small font-semibold text-danger">{t.card.dangerTitle}</p>
            <p className="mt-1 text-body">{t.card.dangerText}</p>
          </Card>
        </Example>
        <Example caption={t.card.warning}>
          <Card tone="warning">
            <p className="text-small font-semibold text-warning">{t.card.warningTitle}</p>
            <p className="mt-1 text-body">{t.card.warningText}</p>
          </Card>
        </Example>
        <Example caption={t.card.success}>
          <Card tone="success">
            <p className="text-small font-semibold text-success">{t.card.successTitle}</p>
            <p className="mt-1 text-body">{t.card.successText}</p>
          </Card>
        </Example>
      </div>
    </Section>
  )
}

// A start hour: always left to right, so "10:00" does not flip (design language 3).
function Hour({ children }: { children: string }) {
  return <span dir="ltr">{children}</span>
}

// The check button of a row (design language 5.2): a 44px target with a 24px circle in it, filled
// with success and a check when done. ui/ has no component for it yet, so it is composed here.
function CheckButton({ label, done, onToggle }: { label: string; done: boolean; onToggle: () => void }) {
  return (
    <IconButton aria-label={label} aria-pressed={done} onPress={onToggle}>
      <span
        className={cx(
          'flex size-6 items-center justify-center rounded-full border transition-colors duration-(--duration-fast)',
          done ? 'border-success bg-success text-on-brand' : 'border-line-strong',
        )}
      >
        {done ? <Check aria-hidden="true" size={14} strokeWidth={ICON_STROKE} /> : null}
      </span>
    </IconButton>
  )
}

export function ListSection() {
  const [done, setDone] = useState(false)
  return (
    <Section id="list">
      <Example caption={t.list.caption}>
        <List aria-label={t.list.label}>
          <ListRow
            leading={<Hour>{t.list.checkHour}</Hour>}
            title={t.list.checkTitle}
            subtitle={t.list.checkSubtitle}
            done={done}
            trailing={
              <CheckButton
                label={t.list.checkLabel}
                done={done}
                onToggle={() => {
                  setDone((was) => !was)
                }}
              />
            }
          />
          <ListRow
            leading={<Hour>{t.list.doneHour}</Hour>}
            title={t.list.doneTitle}
            subtitle={t.list.doneSubtitle}
            done
            trailing={<Badge tone="success">{t.badge.done}</Badge>}
          />
          <ListRow
            leading={<Hour>{t.list.linkHour}</Hour>}
            title={t.list.linkTitle}
            subtitle={t.list.linkSubtitle}
            to={SELF_PATH}
            trailing={
              <Menu
                trigger={
                  <IconButton aria-label={t.list.linkMenuLabel}>
                    <EllipsisVertical aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                  </IconButton>
                }
              >
                <MenuItem>{t.menu.postpone}</MenuItem>
                <MenuItem tone="danger">{t.menu.remove}</MenuItem>
              </Menu>
            }
          />
          <ListRow title={t.list.longTitle} subtitle={t.list.longSubtitle} />
        </List>
      </Example>
    </Section>
  )
}

export function BadgeSection() {
  return (
    <Section id="badge">
      <Example caption={t.badge.caption} className={ROW}>
        <Badge tone="brand">{t.badge.now}</Badge>
        <Badge tone="success">{t.badge.done}</Badge>
        <Badge tone="warning">{t.badge.late}</Badge>
        <Badge tone="neutral">{t.badge.missed}</Badge>
      </Example>
    </Section>
  )
}

export function ProgressBarSection() {
  return (
    <Section id="progress-bar">
      <Example caption={t.progressBar.empty}>
        <ProgressBar label={t.progressBar.label} value={0} max={345} valueText={t.progressBar.emptyText} />
      </Example>
      <Example caption={t.progressBar.partial}>
        <ProgressBar label={t.progressBar.label} value={60} max={345} valueText={t.progressBar.partialText} />
      </Example>
      <Example caption={t.progressBar.full}>
        <ProgressBar label={t.progressBar.label} value={345} max={345} valueText={t.progressBar.fullText} />
      </Example>
    </Section>
  )
}

export function TextLinkSection() {
  return (
    <Section id="text-link">
      <Example caption={t.textLink.alone}>
        <TextLink to="/" className="inline-flex min-h-touch items-center">
          {t.textLink.backHome}
        </TextLink>
      </Example>
      <Example caption={t.textLink.inSentence}>
        <p className="max-w-prose text-body">
          {t.textLink.sentenceBefore}
          <TextLink to="/settings">{t.textLink.sentenceLink}</TextLink>
          {t.textLink.sentenceAfter}
        </p>
      </Example>
    </Section>
  )
}

export function DisclosureSection() {
  return (
    <Section id="disclosure">
      <Example caption={t.disclosure.closed}>
        <Disclosure label={t.disclosure.label}>{t.disclosure.text}</Disclosure>
      </Example>
      <Example caption={t.disclosure.open}>
        <Disclosure label={t.disclosure.label} defaultExpanded>
          {t.disclosure.text}
        </Disclosure>
      </Example>
    </Section>
  )
}

export function LoadingSection() {
  return (
    <Section id="loading">
      <Example caption={t.loading.list}>
        <LoadingState shape="list" rows={2} />
      </Example>
      <Example caption={t.loading.card}>
        <LoadingState shape="card" />
      </Example>
      <Example caption={t.loading.text}>
        <LoadingState shape="text" rows={4} />
      </Example>
    </Section>
  )
}

export function EmptySection() {
  return (
    <Section id="empty">
      <Example caption={t.empty.full}>
        <EmptyState
          icon={FileText}
          title={t.empty.title}
          description={t.empty.description}
          action={
            <Button>
              <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              {t.empty.action}
            </Button>
          }
        />
      </Example>
      <Example caption={t.empty.titleOnly}>
        <EmptyState icon={CalendarOff} title={t.empty.shortTitle} />
      </Example>
    </Section>
  )
}

export function ErrorSection() {
  const toast = useToast()
  return (
    <Section id="error">
      <Example caption={t.error.default}>
        <ErrorState />
      </Example>
      <Example caption={t.error.custom}>
        <ErrorState
          message={t.error.message}
          retryLabel={he.common.retry}
          onRetry={() => {
            toast.show({ text: t.error.retried })
          }}
        />
      </Example>
    </Section>
  )
}
