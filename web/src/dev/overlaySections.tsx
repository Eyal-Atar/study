import { useState } from 'react'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/useToast'
import { devText } from './devText'
import { Example, ROW, Section } from './Section'

const t = devText

export function DialogSection() {
  const [isRegularOpen, setRegularOpen] = useState(false)
  const [isAlertOpen, setAlertOpen] = useState(false)
  return (
    <Section id="dialog">
      <Example caption={t.dialog.regular}>
        <Button
          variant="secondary"
          onPress={() => {
            setRegularOpen(true)
          }}
        >
          {t.dialog.open}
        </Button>
        <Dialog
          title={t.dialog.title}
          description={t.dialog.description}
          isOpen={isRegularOpen}
          onOpenChange={setRegularOpen}
          footer={
            <>
              <Button
                className="flex-1"
                onPress={() => {
                  setRegularOpen(false)
                }}
              >
                {he.common.save}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setRegularOpen(false)
                }}
              >
                {he.common.cancel}
              </Button>
            </>
          }
        >
          <p className="text-body text-ink">{t.dialog.body}</p>
        </Dialog>
      </Example>
      <Example caption={t.dialog.alert}>
        <Button
          variant="secondary"
          onPress={() => {
            setAlertOpen(true)
          }}
        >
          {t.dialog.openAlert}
        </Button>
        <Dialog
          role="alertdialog"
          title={t.dialog.alertTitle}
          description={t.dialog.alertDescription}
          isOpen={isAlertOpen}
          onOpenChange={setAlertOpen}
          footer={
            <>
              {/* An action that cannot be undone is the danger button, never a red fill. */}
              <Button
                variant="danger"
                className="flex-1"
                onPress={() => {
                  setAlertOpen(false)
                }}
              >
                {he.common.delete}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setAlertOpen(false)
                }}
              >
                {he.common.cancel}
              </Button>
            </>
          }
        />
      </Example>
    </Section>
  )
}

// The region that draws the toasts is rendered once, by the page (the app shell has its own).
export function ToastSection() {
  const toast = useToast()
  return (
    <Section id="toast">
      <Example caption={t.toast.caption} className={ROW}>
        <Button
          variant="secondary"
          onPress={() => {
            toast.show({ text: t.toast.infoText })
          }}
        >
          {t.toast.showInfo}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            toast.show({ text: t.toast.successText, tone: 'success' })
          }}
        >
          {t.toast.showSuccess}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            toast.show({ text: t.toast.errorText, tone: 'error' })
          }}
        >
          {t.toast.showError}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            toast.show({
              text: t.toast.undoText,
              action: {
                label: he.common.undo,
                onAction: () => {
                  toast.show({ text: t.toast.undone })
                },
              },
            })
          }}
        >
          {t.toast.showUndo}
        </Button>
      </Example>
    </Section>
  )
}

export function PageHeaderSection() {
  return (
    <Section id="page-header">
      <p className="max-w-prose text-body text-ink">{t.pageHeader.note}</p>
    </Section>
  )
}
