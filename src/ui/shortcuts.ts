/**
 * Keyboard shortcuts: the list shown in the help (« ? ») and in the tooltips, and the matching of a key press for the
 * shell (`matchShortcut`, pure). Undo / redo stay in `installHistoryShortcuts`, Space and the timeline keys in
 * `Timeline.tsx`; they are listed here for the help. No digit shortcuts: AZERTY types them with Shift.
 */
import { isTextEntry } from '../project/history'

export const SHORTCUT_GROUPS = ['Lecture', 'Montage', 'Projet', 'Vue'] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export interface Shortcut {
  id: string
  /** key combinations as shown, alternatives in order (the first one goes into the tooltips) */
  keys: readonly string[]
  label: string
  group: ShortcutGroup
}

export const SHORTCUTS = [
  { id: 'play', keys: ['Espace'], label: 'Lancer ou mettre en pause', group: 'Lecture' },
  { id: 'seek', keys: ['←', '→'], label: 'Reculer ou avancer d’une seconde', group: 'Lecture' },
  { id: 'seek-long', keys: ['Maj+←', 'Maj+→'], label: 'Reculer ou avancer de 5 secondes', group: 'Lecture' },
  { id: 'seek-ends', keys: ['Début', 'Fin'], label: 'Aller au début ou à la fin du film', group: 'Lecture' },
  { id: 'undo', keys: ['Ctrl+Z'], label: 'Annuler', group: 'Montage' },
  { id: 'redo', keys: ['Ctrl+Maj+Z', 'Ctrl+Y'], label: 'Rétablir', group: 'Montage' },
  { id: 'nudge', keys: ['←', '→'], label: 'Décaler le bloc sélectionné d’une seconde (Maj : d’un dixième)', group: 'Montage' },
  { id: 'add-stop', keys: ['S'], label: 'Ajouter un arrêt à la position du marqueur', group: 'Montage' },
  { id: 'add-text', keys: ['T'], label: 'Ajouter un texte à la tête de lecture', group: 'Montage' },
  { id: 'remove', keys: ['Suppr'], label: 'Supprimer le bloc sélectionné', group: 'Montage' },
  { id: 'zoom', keys: ['Ctrl+molette'], label: 'Zoomer dans la timeline (écran tactile : pincer)', group: 'Montage' },
  { id: 'pick', keys: ['Clic sur la trace'], label: 'Placer la tête de lecture à cet endroit (clic droit ou appui long : ajouter un arrêt ou un texte)', group: 'Montage' },
  { id: 'open', keys: ['Ctrl+O'], label: 'Ouvrir une trace ou un projet', group: 'Projet' },
  { id: 'save', keys: ['Ctrl+S'], label: 'Enregistrer le projet', group: 'Projet' },
  { id: 'export', keys: ['Ctrl+E'], label: 'Ouvrir ou fermer le tiroir d’export', group: 'Projet' },
  { id: 'fit', keys: ['F'], label: 'Recadrer la vue sur la trace', group: 'Vue' },
  { id: 'safe-zones', keys: ['G'], label: 'Afficher ou masquer les zones de sécurité du format (aperçu seulement)', group: 'Vue' },
  { id: 'toggle-panel', keys: ['['], label: 'Replier ou déplier le panneau', group: 'Vue' },
  { id: 'help', keys: ['?'], label: 'Afficher les raccourcis', group: 'Vue' },
  { id: 'close', keys: ['Échap'], label: 'Fermer la fenêtre, puis le tiroir d’export, puis la sélection', group: 'Vue' },
] as const satisfies readonly Shortcut[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** Tooltip text: `label` followed by the first key combination of `id`, « Annuler (Ctrl+Z) ». */
export function withShortcut(label: string, id: ShortcutId): string {
  const shortcut: Shortcut | undefined = SHORTCUTS.find((s) => s.id === id)
  return shortcut ? `${label} (${shortcut.keys[0]})` : label
}

export type ShortcutAction =
  | 'save'
  | 'open'
  | 'export'
  | 'fit'
  | 'safe-zones'
  | 'toggle-panel'
  | 'help'
  | 'close'
  | 'add-stop'
  | 'add-text'
  | 'seek-back'
  | 'seek-forward'
  | 'seek-back-long'
  | 'seek-forward-long'
  | 'seek-start'
  | 'seek-end'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Where the key press happens: `text` a text field or a list (no shortcut at all), `arrows` a control that uses the
 * arrows, Home and End itself (slider, radio, tab: no seeking), `other` anywhere else.
 */
export type KeyFocus = 'text' | 'arrows' | 'other'

const ARROW_CONTROLS = 'input[type="range"], input[type="radio"], [role="slider"], [role="tab"], [role="radio"], [role="listbox"], [role="menu"]'

export function keyFocus(target: EventTarget | null): KeyFocus {
  if (isTextEntry(target) || target instanceof HTMLSelectElement) return 'text'
  if (target instanceof Element && target.closest(ARROW_CONTROLS)) return 'arrows'
  return 'other'
}

/**
 * Shortcut of the shell for a key press, null when none: Ctrl/Cmd+S save, Ctrl/Cmd+O open, Ctrl/Cmd+E export drawer,
 * F fit the view, G the safe zones, [ fold the panel and ? the help (whatever the modifiers that type them: AltGr, Shift), Escape close,
 * S / T add a stop / a text, ← / → seek (Shift: longer), Home / End.
 */
export function matchShortcut(e: KeyLike, focus: KeyFocus): ShortcutAction | null {
  if (focus === 'text') return null
  // « [ » needs AltGr (Ctrl+Alt) on French keyboards: the character decides, not the modifiers
  if (e.key === '[') return e.metaKey ? null : 'toggle-panel'
  if (e.key === '?') return e.metaKey || (e.ctrlKey && !e.altKey) ? null : 'help'
  if (e.altKey) return null
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return null
    if (key === 's') return 'save'
    if (key === 'o') return 'open'
    if (key === 'e') return 'export'
    return null
  }
  if (e.key === 'Escape') return e.shiftKey ? null : 'close'
  if (key === 'f') return e.shiftKey ? null : 'fit'
  if (key === 'g') return e.shiftKey ? null : 'safe-zones'
  if (key === 's') return e.shiftKey ? null : 'add-stop'
  if (key === 't') return e.shiftKey ? null : 'add-text'
  if (focus === 'arrows') return null
  if (e.key === 'ArrowLeft') return e.shiftKey ? 'seek-back-long' : 'seek-back'
  if (e.key === 'ArrowRight') return e.shiftKey ? 'seek-forward-long' : 'seek-forward'
  if (e.shiftKey) return null
  if (e.key === 'Home') return 'seek-start'
  if (e.key === 'End') return 'seek-end'
  return null
}

export const SEEK_STEP_S = 1
export const SEEK_LONG_STEP_S = 5

/** Film time after a seek shortcut from `playheadS` in a film of `totalS` seconds, null for any other action. */
export function seekTime(action: ShortcutAction, playheadS: number, totalS: number): number | null {
  const steps: Partial<Record<ShortcutAction, number>> = {
    'seek-back': -SEEK_STEP_S,
    'seek-forward': SEEK_STEP_S,
    'seek-back-long': -SEEK_LONG_STEP_S,
    'seek-forward-long': SEEK_LONG_STEP_S,
  }
  const end = Math.max(0, totalS)
  if (action === 'seek-start') return 0
  if (action === 'seek-end') return end
  const step = steps[action]
  return step === undefined ? null : Math.min(end, Math.max(0, playheadS + step))
}
