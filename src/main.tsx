import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/fonts.css'
import './index.css'
import './ui/theme.css'
import App from './App.tsx'
import { installOfflineTiles } from './offline/store'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { installExternalLinks } from './platform/externalLinks'

// offline packs: the tile fetcher reads them before the network
installOfflineTiles()
installExternalLinks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
