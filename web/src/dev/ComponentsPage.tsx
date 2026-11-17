import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { cx, FOCUS_RING_NATIVE } from '../ui/styles'
import { TextLink } from '../ui/TextLink'
import { ToastRegion } from '../ui/toast'
import { ButtonSection, IconButtonSection, MenuSection } from './actionSections'
import { devText, SECTIONS } from './devText'
import {
  BadgeSection,
  CardSection,
  CheckButtonSection,
  DisclosureSection,
  EmptySection,
  ErrorSection,
  ListSection,
  LoadingSection,
  ProgressBarSection,
  SectionHeadingSection,
  TextLinkSection,
} from './displaySections'
import {
  CheckboxCardsSection,
  DatePickerSection,
  RadioCardsSection,
  SelectSection,
  TextFieldSection,
  TimeFieldSection,
} from './fieldSections'
import { DialogSection, PageHeaderSection, ToastSection } from './overlaySections'
import { NoteSection, OptionGridSection, SegmentedControlSection } from './s27Sections'

// The look of a TextLink, on a plain <a>: these are anchors inside the page (#button), not routes,
// so the router's Link is not the element for them. 44px high, since each stands alone.
const ANCHOR = cx(
  'inline-flex min-h-touch items-center rounded-badge text-small text-brand underline underline-offset-2',
  'transition-colors duration-(--duration-fast) hover:text-brand-strong',
  FOCUS_RING_NATIVE,
)

// The internal catalogue of the base components (ui/), each in every state, in RTL. S27 and S28
// compose screens from it, and S29 runs its accessibility check on it.
//
// Only in the dev build: the route that loads it is behind import.meta.env.DEV (app/routes.tsx).
// It sits outside RequireAuth and outside the app shell, so it opens without signing in and
// without data, and it renders its own ToastRegion (the shell's is not here).
export function ComponentsPage() {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader
          title={devText.page.title}
          subtitle={devText.page.subtitle}
          action={
            <TextLink to="/" className="inline-flex min-h-touch items-center text-small">
              {devText.page.toApp}
            </TextLink>
          }
        />
        <nav aria-label={devText.page.toc}>
          <ul role="list" className="flex flex-wrap gap-x-4">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={ANCHOR}>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonSection />
        <IconButtonSection />
        <MenuSection />
        <TextFieldSection />
        <SelectSection />
        <DatePickerSection />
        <TimeFieldSection />
        <RadioCardsSection />
        <CheckboxCardsSection />
        <CardSection />
        <SectionHeadingSection />
        <ListSection />
        <CheckButtonSection />
        <BadgeSection />
        <ProgressBarSection />
        <TextLinkSection />
        <DisclosureSection />
        <LoadingSection />
        <EmptySection />
        <ErrorSection />
        <DialogSection />
        <ToastSection />
        <PageHeaderSection />
        <SegmentedControlSection />
        <NoteSection />
        <OptionGridSection />
      </div>
      <ToastRegion />
    </StandalonePage>
  )
}
