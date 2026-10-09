import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { errorMessage } from '../core/errors'
import { saveProject } from './projectActions'
import { Toaster } from './Toaster'
import { showToast } from './toast'

interface State {
  error: unknown
}

function save(): void {
  // the project state may be the very thing that broke: say so instead of failing silently
  saveProject().catch((err: unknown) =>
    showToast({ kind: 'error', text: `Impossible d’enregistrer le projet : ${errorMessage(err)}` }),
  )
}

/** Last resort around the whole app: a render exception shows this card instead of a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('Erreur inconnue') }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <>
        <div className="empty" role="alert">
          <h1 className="empty__title">Une erreur inattendue a interrompu OpenFlyover.</h1>
          <details style={{ width: '100%', textAlign: 'left', fontSize: 12 }}>
            <summary>Détails</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{errorMessage(this.state.error)}</pre>
          </details>
          <div className="empty__actions">
            <button type="button" className="btn btn--secondary" onClick={save}>
              Enregistrer le projet
            </button>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Recharger
            </button>
          </div>
        </div>
        <Toaster />
      </>
    )
  }
}
