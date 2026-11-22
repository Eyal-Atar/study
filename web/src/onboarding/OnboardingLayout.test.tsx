import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_PATHS } from './steps'

const QUESTION = 'What exams are we preparing for?'

// prefers-reduced-motion as the system answers it; every other query is false.
function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

// The layout on the route of its step, with a marker on every other step.
function renderAt(path: string, element: ReactElement) {
  const others = Object.values(STEP_PATHS).filter((other) => other !== path)
  const router = createMemoryRouter(
    [{ path, element }, ...others.map((other) => ({ path: other, element: <p>{other}</p> }))],
    { initialEntries: [path] },
  )
  const view = render(<RouterProvider router={router} />)
  return { router, ...view }
}

// The part under Archi (the earlier answer and the controls), which carries the step's entrance.
function answerPart(container: HTMLElement): HTMLElement {
  const part = container.querySelector('[data-part="answer"]')
  if (!(part instanceof HTMLElement)) throw new Error('no answer part')
  return part
}

const follows = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OnboardingLayout', () => {
  it('Archi asks: his question is the only h1, and he comes before it', () => {
    renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} context="Context" primary={<Button>Next</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    const [heading] = headings
    if (heading === undefined) throw new Error('no heading')
    expect(heading).toHaveTextContent(QUESTION)
    expect(follows(screen.getByRole('img', { name: en.archie.alt.joy }), heading)).toBe(true)
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText(en.onboarding.stepOf(1, 4))).toBeInTheDocument()
    // The controls answer him: they come after the question.
    expect(follows(heading, screen.getByText('Content'))).toBe(true)
  })

  it('marks the current step in the list of four', () => {
    renderAt(
      STEP_PATHS.schedule,
      <OnboardingLayout step={3} mood="intentions" question={QUESTION} primary={null}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    const steps = within(screen.getByRole('navigation', { name: en.onboarding.stepsLabel })).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(steps[2]).toHaveTextContent(en.onboarding.steps[2])
    expect(steps[0]).not.toHaveAttribute('aria-current')
    // S34 decision 4: the fourth step is the fixed hours, and the build is no longer a step.
    expect(en.onboarding.steps[3]).toBe('Busy time')
  })

  it('names the browser tab after the question, and gives the name back when it leaves', () => {
    const { unmount } = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={null}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(document.title).toBe(`${QUESTION} – ${en.appName}`)
    unmount()
    expect(document.title).toBe(en.appName)
  })

  it('step 1 has no way back', () => {
    renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={<Button>Next</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument()
  })

  it.each([
    [2, STEP_PATHS.materials, STEP_PATHS.exams],
    [3, STEP_PATHS.schedule, STEP_PATHS.materials],
    [4, STEP_PATHS.fixedHours, STEP_PATHS.schedule],
  ] as const)('step %i has "Back" at the top, before the steps, and it goes to the step before', async (step, path, previous) => {
    const user = userEvent.setup()
    const { router } = renderAt(
      path,
      <OnboardingLayout step={step} mood="wisdom" question={QUESTION} primary={<Button>Next</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    const back = screen.getByRole('button', { name: en.common.back })
    expect(back).toHaveClass('size-touch')
    expect(follows(back, screen.getByRole('navigation', { name: en.onboarding.stepsLabel }))).toBe(true)
    await user.click(back)
    expect(router.state.location.pathname).toBe(previous)
  })

  it('a step with something to finish before it is left takes "Back" over', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const { router } = renderAt(
      STEP_PATHS.materials,
      <OnboardingLayout step={2} mood="wisdom" question={QUESTION} primary={null} onBack={onBack}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe(STEP_PATHS.materials)
  })

  it('a screen that is not a place to go back from shows no "Back"', () => {
    renderAt(
      STEP_PATHS.building,
      <OnboardingLayout step={4} mood="wisdom" question={QUESTION} primary={null} onBack={null}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument()
  })

  it('the bottom holds only the primary button, then the secondary one: no "Back" there', () => {
    renderAt(
      STEP_PATHS.materials,
      <OnboardingLayout
        step={2}
        mood="wisdom"
        question={QUESTION}
        primary={<Button>Continue</Button>}
        secondary={<Button variant="secondary">Skip</Button>}
      >
        <p>Content</p>
      </OnboardingLayout>,
    )
    const bar = screen.getByRole('button', { name: 'Continue' }).parentElement
    if (bar === null) throw new Error('no actions bar')
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Continue', 'Skip'])
    // The whole screen: "Back" at the top, then the two of the bottom.
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      en.common.back,
      'Continue',
      'Skip',
    ])
  })

  it('an earlier answer is one quiet line between Archi and the controls, with the user’s words in their own direction', () => {
    const { container } = renderAt(
      STEP_PATHS.materials,
      <OnboardingLayout
        step={2}
        mood="wisdom"
        question={QUESTION}
        below="Below"
        recap={{ label: '2 exams:', value: 'אלגוריתמים, הסתברות' }}
        primary={null}
      >
        <p>Content</p>
      </OnboardingLayout>,
    )
    const value = screen.getByText('אלגוריתמים, הסתברות')
    expect(value.closest('[dir="auto"]')).not.toBeNull()
    expect(answerPart(container)).toContainElement(value)
    expect(follows(screen.getByText('Below'), value)).toBe(true)
    expect(follows(value, screen.getByText('Content'))).toBe(true)
  })

  it('the controls sit on one card, and a step that lays out its own gets none', () => {
    const { container, unmount } = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={null}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(screen.getByText('Content').closest('.rounded-card')).not.toBeNull()
    expect(answerPart(container).querySelectorAll('.rounded-card')).toHaveLength(1)
    unmount()

    const bare = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={null} bare>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(answerPart(bare.container).querySelector('.rounded-card')).toBeNull()
  })

  it('a new step comes in with a short fade and an 8px slide, and the question never moves', () => {
    mockReducedMotion(false)
    const { container } = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={<Button>Next</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    const answer = answerPart(container)
    expect(answer).toHaveAttribute('data-entering')
    expect(answer).toHaveClass(
      'motion-safe:transition-[opacity,translate]',
      'motion-safe:duration-180',
      'motion-safe:starting:opacity-0',
      'motion-safe:starting:translate-y-2',
    )
    // Every motion class is behind motion-safe.
    const moving = [...answer.classList].filter((name) => /transition|duration|starting|translate|opacity|animate/.test(name))
    expect(moving.every((name) => name.startsWith('motion-safe:'))).toBe(true)
    // The h1 is outside the part that enters, and has no motion of its own.
    const heading = screen.getByRole('heading', { level: 1 })
    expect(answer).not.toContainElement(heading)
    expect(heading.className).not.toMatch(/transition|starting|animate/)
  })

  it('with reduced motion the step is simply there: no transition and no entrance', () => {
    mockReducedMotion(true)
    const { container } = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={<Button>Next</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    const answer = answerPart(container)
    expect(answer).not.toHaveAttribute('data-entering')
    expect(answer.className).not.toMatch(/transition|duration|starting|translate|opacity|animate/)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('does not narrow itself: the width is the column of the shell', () => {
    const { container } = renderAt(
      STEP_PATHS.exams,
      <OnboardingLayout step={1} mood="joy" question={QUESTION} primary={<Button>Continue</Button>}>
        <p>Content</p>
      </OnboardingLayout>,
    )
    expect(container.querySelector('[class*="max-w-xl"]')).toBeNull()
  })
})
