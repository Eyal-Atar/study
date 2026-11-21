import { useState } from 'react'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { TextField } from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { devText } from './devText'
import { Example, ROW, Section } from './Section'

const t = devText

export function DialogSection() {
  const [isRegularOpen, setRegularOpen] = useState(false)
  const [isAlertOpen, setAlertOpen] = useState(false)
  const [isFormOpen, setFormOpen] = useState(false)
  const [name, setName] = useState<string>(t.dialog.formValue)
  const [isNameMissing, setNameMissing] = useState(false)
  const toast = useToast()
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
                {en.common.save}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setRegularOpen(false)
                }}
              >
                {en.common.cancel}
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
                {en.common.delete}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setAlertOpen(false)
                }}
              >
                {en.common.cancel}
              </Button>
            </>
          }
        />
      </Example>
      <Example caption={t.dialog.form}>
        <Button
          variant="secondary"
          onPress={() => {
            setFormOpen(true)
          }}
        >
          {t.dialog.openForm}
        </Button>
        {/* onSubmit makes the body a form: Enter in the field and the submit button both land here. */}
        <Dialog
          title={t.dialog.formTitle}
          isOpen={isFormOpen}
          onOpenChange={setFormOpen}
          onSubmit={() => {
            if (name.trim() === '') {
              setNameMissing(true)
              return
            }
            setFormOpen(false)
            toast.show({ text: `${t.dialog.formSaved} ${name.trim()}`, tone: 'success' })
          }}
          footer={
            <>
              <Button type="submit" className="flex-1">
                {en.common.save}
              </Button>
              <Button
                variant="secondary"
                onPress={() => {
                  setFormOpen(false)
                }}
              >
                {en.common.cancel}
              </Button>
            </>
          }
        >
          <TextField
            label={t.dialog.formField}
            value={name}
            onChange={(value) => {
              setName(value)
              setNameMissing(false)
            }}
            errorMessage={isNameMissing ? t.dialog.formError : undefined}
          />
        </Dialog>
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
                label: en.common.undo,
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
