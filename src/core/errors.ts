/** Human-readable message for anything thrown or rejected (Error, string from a Tauri command…), shown to the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'erreur inconnue'
}
