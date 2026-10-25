import { StrictMode } from 'react'
import { I18nProvider } from 'react-aria-components'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './index.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html has no #root element')
}

createRoot(root).render(
  <StrictMode>
    <I18nProvider locale="he-IL">
      <App />
    </I18nProvider>
  </StrictMode>,
)
