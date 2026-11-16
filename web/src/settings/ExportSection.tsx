import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { downloadJson, localDate, useExportData } from './api'

const t = he.settings.export

// GET /me/export → studyflow-export-YYYY-MM-DD.json (S15 decision 10).
export function ExportSection() {
  const exportData = useExportData()
  const toast = useToast()
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-ink-muted">{t.description}</p>
      <Button
        variant="secondary"
        isDisabled={exportData.isPending}
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
        {exportData.isPending ? t.loading : t.button}
      </Button>
    </div>
  )
}
