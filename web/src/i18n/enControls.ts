// The texts of the shared controls of ui/ that S34 added (Stepper, IconChoiceCards). A module of
// their own, wired into en.ts as en.controls. No isolate(): nothing here holds user content.
export const enControls = {
  stepper: { more: 'More', less: 'Less' },
  // The name of the mark on a chosen tile, for a test or a screen reader that needs it.
  choiceSelected: 'Selected',
} as const
