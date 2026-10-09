import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('keeps the French messages written by the app', () => {
    expect(errorMessage(new Error('Fichier GPX invalide : XML mal formé'))).toBe('Fichier GPX invalide : XML mal formé')
    expect(errorMessage(new RangeError('trace sans horodatage'))).toBe('trace sans horodatage')
    expect(errorMessage('ffmpeg a échoué : code 1')).toBe('ffmpeg a échoué : code 1')
  })

  it('translates known browser errors by name', () => {
    expect(errorMessage(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toMatch(/stockage/)
    expect(errorMessage(new DOMException('denied', 'NotAllowedError'))).toMatch(/Autorisation refusée/)
    expect(errorMessage(new DOMException('gone', 'NotFoundError'))).toMatch(/introuvable/)
    expect(errorMessage(new DOMException('x', 'EncodingError'))).toMatch(/encodage/)
  })

  it('translates Tauri / OS strings', () => {
    expect(errorMessage('No such file or directory (os error 2)')).toMatch(/introuvable/)
    expect(errorMessage('Access is denied. (os error 5)')).toMatch(/Accès refusé/)
    expect(errorMessage('forbidden path: C:\\x')).toMatch(/Accès refusé/)
  })

  it('wraps other platform errors in a generic French sentence', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/connexion/)
    expect(errorMessage(new DOMException('weird', 'DataError'))).toBe('Erreur inattendue (weird)')
  })

  it('has a fallback for empty values', () => {
    expect(errorMessage(undefined)).toBe('erreur inconnue')
    expect(errorMessage(new Error(''))).toBe('erreur inconnue')
  })
})
