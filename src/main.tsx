import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist/latin-400.css'
import '@fontsource/geist/latin-500.css'
import '@fontsource/geist/latin-600.css'
import '@fontsource/geist/latin-700.css'
import '@fontsource/geist/latin-ext-400.css'
import '@fontsource/geist/latin-ext-500.css'
import '@fontsource/geist/latin-ext-600.css'
import '@fontsource/geist/latin-ext-700.css'
import '@fontsource/m-plus-rounded-1c/japanese-400.css'
import '@fontsource/m-plus-rounded-1c/japanese-500.css'
import '@fontsource/m-plus-rounded-1c/japanese-700.css'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { initializeDisplayMode } from './services/display.ts'

initializeDisplayMode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
