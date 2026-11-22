import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { cx, FOCUS_RING_NATIVE } from '../ui/styles'
import { TextLink } from '../ui/TextLink'
import { ToastRegion } from '../ui/toast'
import { ButtonSection, IconButtonSection, MenuSection } from './actionSections'
import { ArchieSection } from './archieSections'
import { ARCHIE_SECTIONS } from './archieText'
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
import { IconsSection } from './iconSections'
import { ColoursSection, ExamPaletteSection, ShapeSection, TypographySection } from './paletteSections'
import { DialogSection, PageHeaderSection, ToastSection } from './overlaySections'
import { NoteSection, OptionGridSection, SegmentedControlSection } from './s27Sections'
import { CollapsibleSectionSection, CompactSelectSection, SwitchSection } from './s28Sections'
import { ActionCardSection, BlockCheckSection, ProgressRingSection } from './s32Sections'
import { S34Sections } from './s34Sections'
import { ShellSection } from './shellSections'
import { UserContentSection } from './userContentSections'

// The table of contents: the sections of devText.ts, and Archie's entry from its own file.
const TOC = [...SECTIONS, ...ARCHIE_SECTIONS]

// The look of a TextLink, on a plain <a>: these are anchors inside the page (#button), not routes,
// so the router's Link is not the element for them. 44px high, since each stands alone.
const ANCHOR = cx(
  'inline-flex min-h-touch items-center rounded-badge text-small text-brand-strong underline underline-offset-2',
  'transition-colors duration-(--duration-fast) hover:text-brand-strong',
  FOCUS_RING_NATIVE,
)

// The internal catalogue of the design language (S31: the exam palette, the colours, the type,
// the corners and shadows, the pieces of the shell) and of the base components (ui/), each in
// every state, in English and left to right. S27 and S28
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
            {TOC.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={ANCHOR}>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {/* S31: the design language, then the pieces of the shell. */}
        <ExamPaletteSection />
        <ColoursSection />
        <TypographySection />
        <ShapeSection />
        <ShellSection />
        <ArchieSection />
        {/* S39: the icon set and the rule for user content. */}
        <IconsSection />
        <UserContentSection />
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
        {/* S28 */}
        <SwitchSection />
        <CompactSelectSection />
        <CollapsibleSectionSection />
        {/* S32 */}
        <BlockCheckSection />
        <ProgressRingSection />
        <ActionCardSection />
        <S34Sections />
      </div>
      <ToastRegion />
    </StandalonePage>
  )
}
