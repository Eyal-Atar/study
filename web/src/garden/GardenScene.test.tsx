import { fireEvent, render } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { GardenScene, PlantShape } from './GardenScene'
import type { GardenModel, GardenPlant, GardenStone, Stage } from './model'

// The garden scene of S33 (Task 5): the plant at the centre by stage, a plant per exam in its
// fixed place, the stones in front, the streak flowers, and the items a keyboard can choose.

function plant(overrides: Partial<GardenPlant> = {}): GardenPlant {
  return {
    id: 'exam-1',
    name: 'Algorithms',
    colorIndex: 0,
    growth: 'stem',
    state: 'active',
    percent: 40,
    closedOn: null,
    studiedMinutes: 0,
    ...overrides,
  }
}

function stone(overrides: Partial<GardenStone> = {}): GardenStone {
  return { key: 'first_task', group: 'first', tier: 1, tiers: 1, earnedAt: '2026-11-20', ...overrides }
}

function model(overrides: Partial<GardenModel> = {}): GardenModel {
  return {
    stage: 'sapling',
    level: 7,
    maxLevel: 50,
    leaves: 0,
    rings: 0,
    plants: [],
    stones: [],
    flowers: 0,
    branches: 0,
    buds: 0,
    streakCurrent: 0,
    ...overrides,
  }
}

function scene(props: Partial<Parameters<typeof GardenScene>[0]> = {}) {
  const { container } = render(<GardenScene model={model()} label="The garden" {...props} />)
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('no svg')
  return { container, svg }
}

const FULL = model({
  stage: 'bonsai',
  leaves: 4,
  rings: 3,
  plants: [plant({ id: 'a' }), plant({ id: 'b', name: 'Calculus', growth: 'bloom', colorIndex: 3 })],
  stones: [stone(), stone({ key: 'task_master_10', group: 'blocks', tiers: 4 })],
  flowers: 3,
  branches: 1,
  streakCurrent: 10,
})

const STAGES: Stage[] = ['seed', 'sprout', 'sapling', 'young', 'bonsai', 'garden']

describe('GardenScene', () => {
  it('is a group named by its label, on a sky drawn in CSS', () => {
    const { container, svg } = scene()

    expect(svg).toHaveAttribute('role', 'group')
    expect(svg).toHaveAttribute('aria-label', 'The garden')
    expect(svg).toHaveAttribute('viewBox', '0 0 360 160')
    expect(container.firstElementChild).toHaveClass('from-sky-from', 'to-sky-to')
  })

  it.each(STAGES)('%s: the centre names its stage', (stage) => {
    const { svg } = scene({ model: model({ stage }) })

    expect(svg.querySelector('[data-item="tree"]')).toHaveAttribute('data-stage', stage)
  })

  it.each(STAGES)('%s: draws one leaf per leaf of the model and one ring per ring', (stage) => {
    const { svg } = scene({ model: model({ stage, leaves: 4, rings: 3 }) })

    expect(svg.querySelectorAll('[data-leaf]')).toHaveLength(4)
    expect(svg.querySelectorAll('[data-ring]')).toHaveLength(3)
  })

  it('has room for nine leaves and eight rings', () => {
    const { svg } = scene({ model: model({ stage: 'garden', leaves: 9, rings: 8 }) })

    expect(svg.querySelectorAll('[data-leaf]')).toHaveLength(9)
    expect(svg.querySelectorAll('[data-ring]')).toHaveLength(8)
  })

  it('only the garden stage has the pond', () => {
    expect(scene({ model: model({ stage: 'garden' }) }).svg.querySelector('[data-part="pond"]')).not.toBeNull()
    expect(scene({ model: model({ stage: 'bonsai' }) }).svg.querySelector('[data-part="pond"]')).toBeNull()
  })

  it('puts the plants in their fixed places, alternating sides', () => {
    const plants = [plant({ id: 'a' }), plant({ id: 'b' }), plant({ id: 'c' })]
    const { svg } = scene({ model: model({ plants }) })

    const items = [...svg.querySelectorAll('[data-item^="plant:"]')]
    expect(items.map((g) => g.getAttribute('data-item'))).toEqual(['plant:a', 'plant:b', 'plant:c'])
    expect(items.map((g) => g.getAttribute('data-x'))).toEqual(['140', '220', '104'])
  })

  it('a bloom has the colour of its exam on its petals and a gold centre', () => {
    const { svg } = scene({ model: model({ plants: [plant({ growth: 'bloom', colorIndex: 5 })] }) })

    const petals = svg.querySelectorAll('[data-petal]')
    expect(petals).toHaveLength(5)
    for (const petal of petals) expect(petal).toHaveClass(examColor(5).fill, 'stroke-ink')
    expect(svg.querySelector('[data-part="flower-centre"]')).toHaveClass('fill-gold')
  })

  it('draws one stone per earned stone, and the streak flowers', () => {
    const { svg } = scene({ model: FULL })

    expect(svg.querySelectorAll('[data-item^="stone:"]')).toHaveLength(2)
    expect(svg.querySelectorAll('[data-flower]')).toHaveLength(3)
    expect(svg.querySelectorAll('[data-branch]')).toHaveLength(1)
  })

  it('draws the buds of a streak that ended', () => {
    const { svg } = scene({ model: model({ buds: 4 }) })

    expect(svg.querySelectorAll('[data-bud]')).toHaveLength(4)
    expect(svg.querySelector('[data-item="flowers"]')).not.toBeNull()
  })

  it('has no flower item when there is nothing to show there', () => {
    const { svg } = scene()

    expect(svg.querySelector('[data-item="flowers"]')).toBeNull()
  })

  it('without onSelect nothing is focusable and nothing is a button', () => {
    const { svg } = scene({ model: FULL })

    expect(svg.querySelectorAll('[tabindex]')).toHaveLength(0)
    expect(svg.querySelectorAll('[role="button"]')).toHaveLength(0)
  })

  it('with onSelect every item is a named button with a 44-unit target', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn() })

    const buttons = [...svg.querySelectorAll('[role="button"]')]
    // The tree, two plants, two stones and the flowers.
    expect(buttons).toHaveLength(6)
    for (const button of buttons) {
      expect(button).toHaveAttribute('tabindex', '0')
      expect(button.getAttribute('aria-label')).toBeTruthy()
      const hit = svg.querySelector(`[data-hit="${button.getAttribute('data-item') ?? ''}"]`)
      if (hit === null) throw new Error('no hit area')
      const size =
        hit.tagName === 'circle'
          ? Number(hit.getAttribute('r')) * 2
          : Math.min(Number(hit.getAttribute('width')), Number(hit.getAttribute('height')))
      expect(size).toBeGreaterThanOrEqual(44)
    }
  })

  it('draws every hit area in one layer under all the art, so drawn art takes its own taps', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn() })

    const hits = [...svg.querySelectorAll('[data-hit]')]
    const buttons = [...svg.querySelectorAll('[role="button"]')]
    expect(hits).toHaveLength(buttons.length)
    for (const hit of hits) {
      expect(hit.closest('[role="button"]')).toBeNull()
      for (const button of buttons) {
        expect(hit.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
    }
  })

  it('a tap on empty sand inside an item\'s area selects that item', async () => {
    const onSelect = vi.fn()
    const { svg } = scene({ model: FULL, onSelect })

    const hit = svg.querySelector('[data-hit="stone:task_master_10"]')
    if (hit === null) throw new Error('no hit area')
    await userEvent.click(hit)
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'stone', key: 'task_master_10' })
  })

  it('a tap on the art of a back-row stone or on the stem of plant 140 selects that thing', async () => {
    const onSelect = vi.fn()
    const stones = Array.from({ length: 6 }, (_, i) => stone({ key: `k${String(i)}` }))
    const { svg } = scene({ model: model({ plants: [plant({ id: 'a' })], stones }), onSelect })

    // The stone at (129, 128) is in the back row; its front neighbours are drawn after it.
    const back = svg.querySelector('[data-item="stone:k3"]')
    expect(back?.getAttribute('transform')).toMatch(/ 128\)$/)
    const art = back?.querySelector('[data-part="stone"]')
    if (!art) throw new Error('no stone art')
    await userEvent.click(art)
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'stone', key: 'k3' })

    const stem = svg.querySelector('[data-item="plant:a"] [data-part="stem"]')
    if (stem === null) throw new Error('no stem')
    await userEvent.click(stem)
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'plant', id: 'a' })
  })

  it('keeps every stone inside the card and clear of the streak flowers', () => {
    const stones = Array.from({ length: 18 }, (_, i) => stone({ key: `k${String(i)}` }))
    const widest = model({ stones, flowers: 6, branches: 4, streakCurrent: 34 })
    const { svg } = scene({ model: widest, onSelect: vi.fn() })

    const flowers = svg.querySelector('[data-hit="flowers"]')
    if (flowers === null) throw new Error('no flowers area')
    const fx = Number(flowers.getAttribute('x'))
    const fy = Number(flowers.getAttribute('y'))
    const fw = Number(flowers.getAttribute('width'))
    const fh = Number(flowers.getAttribute('height'))
    const placed = [...svg.querySelectorAll('[data-item^="stone:"]')]
    expect(placed).toHaveLength(18)
    for (const item of placed) {
      const [x = NaN, y = NaN] = (/translate\(([-\d.]+) ([-\d.]+)\)/.exec(item.getAttribute('transform') ?? '') ?? [])
        .slice(1)
        .map(Number)
      const half = 14.4
      expect(x - half).toBeGreaterThanOrEqual(0)
      expect(x + half).toBeLessThanOrEqual(360)
      const apart = x + half <= fx || x - half >= fx + fw || y + half <= fy || y - half >= fy + fh
      expect(apart).toBe(true)
    }
  })

  it('without flowers the stones still stay inside the card', () => {
    const stones = Array.from({ length: 18 }, (_, i) => stone({ key: `k${String(i)}` }))
    const { svg } = scene({ model: model({ stones }) })

    for (const item of svg.querySelectorAll('[data-item^="stone:"]')) {
      const x = Number(/translate\(([-\d.]+) /.exec(item.getAttribute('transform') ?? '')?.[1])
      expect(x).toBeGreaterThanOrEqual(14.4)
      expect(x).toBeLessThanOrEqual(360 - 14.4)
    }
  })

  it('the buds have a short name', () => {
    const { svg } = scene({ model: model({ buds: 3 }), onSelect: vi.fn() })

    expect(svg.querySelector('[data-item="flowers"]')).toHaveAttribute('aria-label', en.garden.scene.buds)
  })

  it('names each item by its short name', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn() })

    const label = (item: string) => svg.querySelector(`[data-item="${item}"]`)?.getAttribute('aria-label')
    expect(label('tree')).toBe(en.garden.scene.stage.bonsai)
    expect(label('plant:b')).toBe(isolate('Calculus'))
    expect(label('stone:task_master_10')).toBe(en.progress.badges.items.task_master_10.name)
    expect(label('flowers')).toBe(en.garden.celebrate.streak(10))
  })

  it('Enter and Space choose the item', async () => {
    const onSelect = vi.fn()
    const { svg } = scene({ model: FULL, onSelect })

    const tree = svg.querySelector<SVGGElement>('[data-item="tree"]')
    const plantB = svg.querySelector<SVGGElement>('[data-item="plant:b"]')
    const stoneItem = svg.querySelector<SVGGElement>('[data-item="stone:first_task"]')
    const flowers = svg.querySelector<SVGGElement>('[data-item="flowers"]')
    if (!tree || !plantB || !stoneItem || !flowers) throw new Error('missing item')

    tree.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'tree' })

    plantB.focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'plant', id: 'b' })

    stoneItem.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'stone', key: 'first_task' })

    await userEvent.click(flowers)
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'flowers' })
    expect(onSelect).toHaveBeenCalledTimes(4)
  })

  it('Space does not scroll the page', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn() })
    const tree = svg.querySelector('[data-item="tree"]')
    if (tree === null) throw new Error('no tree')

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fireEvent(tree, event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('marks the selected item', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn(), selected: { kind: 'plant', id: 'a' } })

    expect(svg.querySelector('[data-item="plant:a"]')).toHaveAttribute('aria-pressed', 'true')
    expect(svg.querySelector('[data-item="tree"]')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps every decoration from the screen reader', () => {
    const { svg } = scene({ model: FULL, onSelect: vi.fn() })

    // Inside each button and outside them, the drawing is aria-hidden.
    for (const button of svg.querySelectorAll('[role="button"]')) {
      for (const child of button.children) expect(child).toHaveAttribute('aria-hidden', 'true')
    }
    for (const child of svg.children) {
      if (child.getAttribute('role') !== 'button') expect(child).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('has no motion without play', () => {
    const { container } = scene({ model: FULL })

    expect(container.querySelector('.garden-sway')).toBeNull()
    expect(container.querySelector('.garden-leaf-fall')).toBeNull()
    expect(container.querySelector('.garden-petal')).toBeNull()
  })

  it('play "open" sways the centre once and lets one leaf fall', () => {
    const { container } = scene({ model: FULL, play: 'open' })

    expect(container.querySelectorAll('.garden-sway')).toHaveLength(1)
    expect(container.querySelector('[data-item="tree"] .garden-sway')).not.toBeNull()
    expect(container.querySelectorAll('.garden-leaf-fall')).toHaveLength(1)
    // The falling leaf is extra: the leaves of the model all stay.
    expect(container.querySelectorAll('[data-leaf]')).toHaveLength(4)
  })
})

describe('PlantShape', () => {
  function shape(props: Parameters<typeof PlantShape>[0]) {
    const { container } = render(
      <svg>
        <PlantShape {...props} />
      </svg>,
    )
    return container
  }

  it.each(['seed', 'sprout', 'stem', 'bud', 'bloom'] as const)('%s: names its growth', (growth) => {
    expect(shape({ growth, colorIndex: 1 }).querySelector('g')).toHaveAttribute('data-growth', growth)
  })

  it('a bud has the colour of its exam', () => {
    expect(shape({ growth: 'bud', colorIndex: 2 }).querySelector('[data-part="bud"]')).toHaveClass(examColor(2).fill)
  })

  it('opening opens the petals one after another', () => {
    const petals = [...shape({ growth: 'bloom', colorIndex: 1, opening: true }).querySelectorAll('.garden-petal')]

    expect(petals).toHaveLength(5)
    expect(petals.map((p) => (p as SVGElement).style.animationDelay)).toEqual(['0ms', '120ms', '240ms', '360ms', '480ms'])
  })

  it('without opening the petals do not move', () => {
    expect(shape({ growth: 'bloom', colorIndex: 1 }).querySelector('.garden-petal')).toBeNull()
  })
})
