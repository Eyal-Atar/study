import { Download } from '../ui/icons'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { ICON_STROKE } from '../ui/styles'
import { useToast } from '../ui/useToast'
import { downloadJson, localDate, useExportData } from './api'

const t = en.settings.export

// GET /me/export → studyflow-export-YYYY-MM-DD.json (S15 decision 10).
export function ExportSection() {
  const exportData = useExportData()
  const toast = useToast()
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="max-w-prose text-small text-ink-muted">{t.description}</p>
      <Button
        variant="secondary"
        isPending={exportData.isPending}
        onPress={() => {
          exportData.mutate(undefined, {
            onSuccess: (data) => {
              downloadJson(data, `studyflow-export-${localDate()}.json`)
            },
            onError: (error) => {
              toast.show({ text: errorMessage(error), tone: 'error' })
            },
          })
        }}
      >
        <Download aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        {t.button}
      </Button>
    </div>
  )
}
