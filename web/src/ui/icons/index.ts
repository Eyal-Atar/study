import {
  CheckMarkIcon,
  ClassIcon,
  FreeTimeIcon,
  NextSlotIcon,
  OfflineIcon,
  PickTimeIcon,
  PracticeExamIcon,
  WorkIcon,
} from './actions'
import { BlossomIcon, SproutIcon, StoneIcon, StreakLeafIcon, TeaCupIcon, XpSparkIcon } from './archi'
import { EveningIcon, MorningIcon, NightIcon, NoonIcon } from './dayparts'
import type { IconComponent } from './Icon'
import {
  LearningIcon,
  PracticeIcon,
  ReviewIcon,
  SimulationIcon,
  SimulationReviewIcon,
  TaskIcon,
} from './kinds'

export { createIcon } from './Icon'
export type { IconComponent, IconProps, IconType } from './Icon'
export * from './actions'
export * from './archi'
export * from './dayparts'
export * from './glyphs'
export * from './kinds'
export * from './maps'

/** Every icon drawn for Archi, by name: for the components page and for the tests. */
export const ARCHI_ICONS: Record<string, IconComponent> = {
  StreakLeafIcon,
  XpSparkIcon,
  TeaCupIcon,
  SproutIcon,
  StoneIcon,
  BlossomIcon,
  MorningIcon,
  NoonIcon,
  EveningIcon,
  NightIcon,
  LearningIcon,
  PracticeIcon,
  ReviewIcon,
  SimulationIcon,
  SimulationReviewIcon,
  TaskIcon,
  FreeTimeIcon,
  NextSlotIcon,
  PickTimeIcon,
  PracticeExamIcon,
  OfflineIcon,
  WorkIcon,
  ClassIcon,
  CheckMarkIcon,
}
