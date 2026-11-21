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

/*
  The lookups live apart from the drawings: a file of components exports only components, so fast
  refresh keeps working on them.
*/

/** The icon of each part of the day. */
export const DAYPART_ICON: Record<'morning' | 'afternoon' | 'evening' | 'night', IconComponent> = {
  morning: MorningIcon,
  afternoon: NoonIcon,
  evening: EveningIcon,
  night: NightIcon,
}

/** The icon of each kind of task. */
export const KIND_ICON: Record<
  'learn' | 'practice' | 'review' | 'simulation' | 'simulation_review' | 'custom',
  IconComponent
> = {
  learn: LearningIcon,
  practice: PracticeIcon,
  review: ReviewIcon,
  simulation: SimulationIcon,
  simulation_review: SimulationReviewIcon,
  custom: TaskIcon,
}
