/** Text of anything thrown: its message for an Error, else the value as a string. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
