import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import './styles/fonts.css'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { initializeDisplayMode, initializeFontScale } from './services/display.ts'

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }
  return String(error)
}

function renderFatalError(message: string) {
  const root = document.getElementById('root') ?? document.body
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--background, #f7f5fa);color:var(--foreground, #1f1727);font-family:Geist, system-ui, sans-serif;">
      <div style="width:100%;max-width:960px;border:1px solid rgba(153,116,184,0.18);border-radius:20px;background:white;padding:24px;box-shadow:0 1px 2px rgba(77,53,101,0.05), 0 10px 28px rgba(77,53,101,0.04);">
        <h1 style="margin:0;font-size:24px;line-height:1.2;">Runtime error</h1>
        <p style="margin:12px 0 0;color:#6f6878;font-size:14px;line-height:1.5;">The dev app hit an unexpected error before it could finish rendering.</p>
        <pre style="margin:16px 0 0;overflow:auto;border-radius:16px;background:rgba(153,116,184,0.08);padding:16px;font-size:12px;line-height:1.5;white-space:pre-wrap;">${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
      </div>
    </div>
  `
}

if (import.meta.env.DEV) {
  window.addEventListener('error', (event) => {
    renderFatalError(formatError(event.error ?? event.message))
  })
  window.addEventListener('unhandledrejection', (event) => {
    renderFatalError(formatError(event.reason))
  })
}

try {
  initializeDisplayMode()
  initializeFontScale()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </I18nProvider>
    </StrictMode>,
  )
} catch (error) {
  renderFatalError(formatError(error))
}
