/** Short French sentences for the browser errors (DOMException names, WebCodecs) that reach the user. */
const BY_NAME: Record<string, string> = {
  QuotaExceededError: "Espace de stockage insuffisant : libérez de la place puis réessayez.",
  NotAllowedError: 'Autorisation refusée par le navigateur ou le système.',
  SecurityError: 'Accès refusé pour des raisons de sécurité.',
  NotFoundError: 'Fichier ou dossier introuvable.',
  NotReadableError: 'Fichier illisible : il est peut-être utilisé par un autre programme.',
  AbortError: 'Opération interrompue.',
  EncodingError: "Échec de l'encodage ou du décodage.",
  NotSupportedError: "Format ou fonction non pris en charge par ce navigateur.",
  OperationError: "L'opération a échoué.",
  InvalidStateError: "Opération impossible dans l'état actuel.",
}

/** Tauri / OS messages (English strings, not Errors), checked in order. */
const BY_TEXT: [RegExp, string][] = [
  [/no such file|not found|os error (2|3)\b|cannot find/i, 'Fichier ou dossier introuvable.'],
  [/permission denied|access is denied|forbidden path|not allowed|os error (5|13)\b/i, "Accès refusé : vérifiez les droits d'accès au fichier ou au dossier."],
  [/no space left|disk full|not enough space|os error (28|112)\b/i, "Espace disque insuffisant."],
  [/being used by another process|os error 32\b/i, 'Fichier utilisé par un autre programme.'],
]

const technical = (text: string): string => `Erreur inattendue (${text})`

/**
 * Message for anything thrown or rejected, shown to the user. Messages written by the app (French) are kept as they are;
 * known browser / system errors become a short French sentence; the rest is « Erreur inattendue (…) ».
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const mapped = BY_NAME[error.name]
    if (mapped) return mapped
    if (!error.message) return 'erreur inconnue'
    // only plain app errors carry a French message of ours; other classes come from the platform
    if (error.name === 'Error' || error.name === 'RangeError') return error.message
    if (error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message)) return 'Connexion impossible : vérifiez votre connexion internet.'
    return technical(error.message)
  }
  if (typeof error === 'string' && error) {
    const mapped = BY_TEXT.find(([pattern]) => pattern.test(error))
    return mapped ? mapped[1] : error
  }
  return 'erreur inconnue'
}
