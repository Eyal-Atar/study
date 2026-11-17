import { CalendarDays, EllipsisVertical, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Menu, MenuItem } from '../ui/Menu'
import { ICON_STROKE } from '../ui/styles'
import { devText } from './devText'
import { Example, ROW, Section } from './Section'

const t = devText

export function ButtonSection() {
  return (
    <Section id="button">
      <Example caption={t.button.variants} className={ROW}>
        <Button>{t.button.primary}</Button>
        <Button variant="secondary">{t.button.secondary}</Button>
        <Button variant="quiet">{t.button.quiet}</Button>
        <Button variant="danger">{t.button.danger}</Button>
      </Example>
      <Example caption={t.button.disabled} className={ROW}>
        <Button isDisabled>{t.button.primary}</Button>
        <Button variant="secondary" isDisabled>
          {t.button.secondary}
        </Button>
        <Button variant="quiet" isDisabled>
          {t.button.quiet}
        </Button>
        <Button variant="danger" isDisabled>
          {t.button.danger}
        </Button>
      </Example>
      <Example caption={t.button.pending} className={ROW}>
        <Button isPending>{t.button.primary}</Button>
        <Button variant="secondary" isPending>
          {t.button.secondary}
        </Button>
      </Example>
      <Example caption={t.button.withIcon} className={ROW}>
        <Button variant="secondary">
          <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          {t.button.addExam}
        </Button>
      </Example>
      <Example caption={t.button.row} className="flex gap-2">
        <Button className="flex-1">{t.button.primary}</Button>
        <Button variant="secondary">{t.button.secondary}</Button>
      </Example>
    </Section>
  )
}

export function IconButtonSection() {
  return (
    <Section id="icon-button">
      <div className="flex flex-wrap gap-6">
        <Example caption={t.iconButton.quiet}>
          <IconButton aria-label={t.iconButton.moreLabel}>
            <EllipsisVertical aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
        </Example>
        <Example caption={t.iconButton.secondary}>
          <IconButton variant="secondary" aria-label={t.iconButton.editLabel}>
            <Pencil aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
        </Example>
        <Example caption={t.iconButton.disabled} className={ROW}>
          <IconButton aria-label={t.iconButton.lockLabel} isDisabled>
            <Lock aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton variant="secondary" aria-label={t.iconButton.lockLabel} isDisabled>
            <Lock aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
        </Example>
      </div>
    </Section>
  )
}

export function MenuSection() {
  const [chosen, setChosen] = useState<string | null>(null)
  return (
    <Section id="menu">
      <Example caption={t.menu.caption} className={ROW}>
        {/* "bottom start": the trigger sits at the start of the row, so the menu opens under it. */}
        <Menu trigger={<Button variant="secondary">{t.menu.trigger}</Button>} placement="bottom start">
          <MenuItem
            icon={CalendarDays}
            onAction={() => {
              setChosen(t.menu.postpone)
            }}
          >
            {t.menu.postpone}
          </MenuItem>
          <MenuItem icon={Lock} isDisabled>
            {t.menu.lock}
          </MenuItem>
          <MenuItem
            icon={Trash2}
            tone="danger"
            onAction={() => {
              setChosen(t.menu.remove)
            }}
          >
            {t.menu.remove}
          </MenuItem>
        </Menu>
        <p className="text-small text-ink-muted">
          {chosen === null ? t.menu.nothingChosen : `${t.menu.chosen} ${chosen}`}
        </p>
      </Example>
    </Section>
  )
}
