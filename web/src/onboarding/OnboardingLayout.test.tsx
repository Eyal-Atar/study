import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { OnboardingLayout } from './OnboardingLayout'

describe('OnboardingLayout', () => {
  it('shows the step, the title as h1, the intro, the content and the actions', () => {
    render(
      <OnboardingLayout step={2} title="Title" intro="Intro" actions={<button type="button">Next</button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText(en.onboarding.stepOf(2, 4))).toBeInTheDocument()
    expect(screen.getByText('Intro')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('marks the current step in the list of four', () => {
    render(
      <OnboardingLayout step={3} title="Title">
        <p>Content</p>
      </OnboardingLayout>,
    )
    const steps = within(screen.getByRole('navigation', { name: en.onboarding.stepsLabel })).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(steps[2]).toHaveTextContent(en.onboarding.steps[2])
    expect(steps[0]).not.toHaveAttribute('aria-current')
  })

  it('names the browser tab after the step, and keeps the intro to a readable width', () => {
    render(
      <OnboardingLayout step={1} title="Title" intro="Intro">
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(document.title).toBe(`Title – ${en.appName}`)
    expect(screen.getByText('Intro')).toHaveClass('max-w-prose')
  })

  it('the primary action comes first, so it is first in the reading order and in the Tab order', () => {
    render(
      <OnboardingLayout
        step={2}
        title="Title"
        actions={
          <>
            <Button>Continue</Button>
            <Button variant="secondary">Back</Button>
          </>
        }
      >
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Continue', 'Back'])
  })

  it('does not narrow itself: the width is the column of the shell', () => {
    const { container } = render(
      <OnboardingLayout step={1} title="Title" actions={<Button>Continue</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(container.querySelector('[class*="max-w-xl"]')).toBeNull()
  })
})
