import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { OnboardingLayout } from './OnboardingLayout'

describe('OnboardingLayout', () => {
  it('shows the step, the title as h1, the intro, the content and the actions', () => {
    render(
      <OnboardingLayout step={2} title="כותרת" intro="הסבר" actions={<button type="button">הבא</button>}>
        <p>תוכן</p>
      </OnboardingLayout>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'כותרת' })).toBeInTheDocument()
    expect(screen.getByText(he.onboarding.stepOf(2, 4))).toBeInTheDocument()
    expect(screen.getByText('הסבר')).toBeInTheDocument()
    expect(screen.getByText('תוכן')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הבא' })).toBeInTheDocument()
  })

  it('marks the current step in the list of four', () => {
    render(
      <OnboardingLayout step={3} title="כותרת">
        <p>תוכן</p>
      </OnboardingLayout>,
    )
    const steps = within(screen.getByRole('navigation', { name: he.onboarding.stepsLabel })).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(steps[2]).toHaveTextContent(he.onboarding.steps[2])
    expect(steps[0]).not.toHaveAttribute('aria-current')
  })
})
