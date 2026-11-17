import { CalendarOff, EllipsisVertical, FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { he } from '../i18n/he'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { CheckButton } from '../ui/CheckButton'
import { Dialog } from '../ui/Dialog'
import { Disclosure } from '../ui/Disclosure'
import { IconButton } from '../ui/IconButton'
import { List, ListRow } from '../ui/List'
import { Menu, MenuItem } from '../ui/Menu'
import { ProgressBar } from '../ui/ProgressBar'
import { SectionHeading } from '../ui/SectionHeading'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
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
      {/* titleLevel 3: on this page the h2 is the heading of the catalogue section. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Example caption={t.card.plain}>
          <Card title={t.card.plainTitle} titleLevel={3}>
            <p className="text-body">{t.card.plainText}</p>
          </Card>
        </Example>
        <Example caption={t.card.danger}>
          <Card tone="danger" title={t.card.dangerTitle} titleLevel={3}>
            <p className="text-body">{t.card.dangerText}</p>
          </Card>
        </Example>
        <Example caption={t.card.warning}>
          <Card tone="warning" title={t.card.warningTitle} titleLevel={3}>
            <p className="text-body">{t.card.warningText}</p>
          </Card>
        </Example>
        <Example caption={t.card.success}>
          <Card tone="success" title={t.card.successTitle} titleLevel={3}>
            <p className="text-body">{t.card.successText}</p>
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

// A section of a screen: its heading names the list under it.
export function SectionHeadingSection() {
  return (
    <Section id="section-heading">
      <Example caption={t.sectionHeading.caption}>
        <SectionHeading id="dev-section-heading" level={3}>
          {t.sectionHeading.title}
        </SectionHeading>
        <List>
          <ListRow title={t.sectionHeading.rowTitle} subtitle={t.sectionHeading.rowSubtitle} />
        </List>
      </Example>
    </Section>
  )
}

export function CheckButtonSection() {
  const [first, setFirst] = useState(false)
  const [second, setSecond] = useState(true)
  return (
    <Section id="check-button">
      <Example caption={t.checkButton.caption} className={ROW}>
        <CheckButton aria-label={t.checkButton.label} isDone={first} onChange={setFirst} />
        <CheckButton aria-label={t.checkButton.doneLabel} isDone={second} onChange={setSecond} />
      </Example>
      <Example caption={t.checkButton.disabled} className={ROW}>
        <CheckButton aria-label={t.checkButton.disabledLabel} isDone={false} isDisabled onChange={noop} />
        <CheckButton aria-label={t.checkButton.disabledDoneLabel} isDone isDisabled onChange={noop} />
      </Example>
    </Section>
  )
}

// A disabled control never calls back.
function noop() {}

export function ListSection() {
  const [done, setDone] = useState(false)
  const [crowdedDone, setCrowdedDone] = useState(false)
  const [isPressOpen, setPressOpen] = useState(false)
  return (
    <Section id="list">
      <Example caption={t.list.caption}>
        <List aria-label={t.list.label}>
          <ListRow
            leading={<Hour>{t.list.checkHour}</Hour>}
            title={t.list.checkTitle}
            subtitle={t.list.checkSubtitle}
            done={done}
            trailing={<CheckButton aria-label={t.list.checkLabel} isDone={done} onChange={setDone} />}
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
          <ListRow
            leading={<Hour>{t.list.pressHour}</Hour>}
            title={t.list.pressTitle}
            subtitle={t.list.pressSubtitle}
            onPress={() => {
              setPressOpen(true)
            }}
          />
          <ListRow
            leading={<Hour>{t.list.crowdedHour}</Hour>}
            title={t.list.crowdedTitle}
            subtitle={t.list.crowdedSubtitle}
            done={crowdedDone}
            trailing={
              <>
                <Badge tone="warning">{t.list.crowdedBadge}</Badge>
                <CheckButton aria-label={t.list.crowdedCheckLabel} isDone={crowdedDone} onChange={setCrowdedDone} />
                <Menu
                  trigger={
                    <IconButton aria-label={t.list.crowdedMenuLabel}>
                      <EllipsisVertical aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                    </IconButton>
                  }
                >
                  <MenuItem>{t.menu.postpone}</MenuItem>
                  <MenuItem tone="danger">{t.menu.remove}</MenuItem>
                </Menu>
              </>
            }
          />
          <ListRow title={t.list.longTitle} subtitle={t.list.longSubtitle} />
        </List>
        <Dialog title={t.list.pressDialogTitle} isOpen={isPressOpen} onOpenChange={setPressOpen}>
          <p className="text-body text-ink">{t.list.pressDialogBody}</p>
        </Dialog>
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
      <Example caption={t.progressBar.percentOnly}>
        <ProgressBar label={t.progressBar.label} value={60} max={345} />
      </Example>
      <Example caption={t.progressBar.ariaOnly}>
        <ProgressBar aria-label={t.progressBar.ariaLabel} value={2} max={5} />
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
      <Example caption={t.textLink.outside}>
        <p className="max-w-prose text-body">
          {t.textLink.outsideBefore}
          <TextLink href={`mailto:${t.textLink.outsideMail}`}>{t.textLink.outsideMail}</TextLink>
          {t.textLink.outsideMiddle}
          <TextLink href="https://example.com/terms">{t.textLink.outsideSite}</TextLink>
          {t.textLink.outsideAfter}
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
      <Example caption={t.empty.noIcon}>
        <EmptyState title={t.empty.noIconTitle} description={t.empty.noIconDescription} />
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
