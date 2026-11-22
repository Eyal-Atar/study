// The texts of the shared controls of ui/ that S34 added (the Stepper). A module of
// their own, wired into en.ts as en.controls. No isolate(): nothing here holds user content.
export const enControls = {
  stepper: { more: 'More', less: 'Less' },
} as const
