/**
 * Which tile sources may be downloaded ahead for offline use, read from each provider's terms (October 2026, links
 * and reasons in docs/sources.md, « Attributions, licenses and offline use »). A source missing from this table is refused.
 */

export interface OfflinePolicy {
  /** sources of one provider share its daily limit */
  provider: string
  allowed: boolean
  /** why (shown when refused, or as a caution when allowed for personal use only) */
  reason: string
  /** allowed for a personal, non-commercial use only, at a gentle pace (the reason is shown as a caution) */
  personalUse?: boolean
  /** tiles per day and per device at most; absent = no limit beyond the polite pace */
  dailyLimit?: number
  /** average tile size measured around Chamonix (bytes), for the estimate */
  typicalTileBytes: number
}

const IGN = { provider: 'ign', allowed: true, reason: 'Licence ouverte Etalab 2.0', dailyLimit: 50_000 } as const
// Personal, non-commercial project: these providers discourage bulk downloads, so they are allowed with a low daily
// cap (a short corridor, once) and the caution is shown in the panel.
const SWISSTOPO = {
  provider: 'swisstopo',
  allowed: true,
  personalUse: true,
  reason: 'Usage personnel : swisstopo préfère son service de téléchargement pour le hors ligne, gardez un couloir court.',
  dailyLimit: 10_000,
} as const

export const OFFLINE_POLICIES: Readonly<Record<string, OfflinePolicy>> = {
  mapterhorn: {
    provider: 'mapterhorn',
    allowed: true,
    reason: 'Données ouvertes ; Mapterhorn propose lui-même le téléchargement de zones',
    dailyLimit: 20_000,
    typicalTileBytes: 150_000,
  },
  'aws-terrarium': {
    provider: 'aws',
    allowed: true,
    reason: 'Archive publique AWS Open Data, faite pour être téléchargée',
    typicalTileBytes: 105_000,
  },
  'ign-ortho': { ...IGN, typicalTileBytes: 16_000 },
  'ign-plan': { ...IGN, typicalTileBytes: 45_000 },
  'ign-ortho-2000-2005': { ...IGN, typicalTileBytes: 16_000 },
  'ign-ortho-1965-1980': { ...IGN, typicalTileBytes: 40_000 },
  'ign-ortho-1950-1965': { ...IGN, typicalTileBytes: 40_000 },
  'eox-s2cloudless': {
    provider: 'eox',
    allowed: true,
    reason: 'CC BY-NC-SA 4.0 : copie permise pour un usage non commercial',
    dailyLimit: 20_000,
    typicalTileBytes: 10_000,
  },
  swisstopo: { ...SWISSTOPO, typicalTileBytes: 20_000 },
  'swisstopo-carte': { ...SWISSTOPO, typicalTileBytes: 30_000 },
  'arcgis-world-imagery': {
    provider: 'esri',
    allowed: true,
    personalUse: true,
    reason: 'Usage personnel : Esri réserve normalement le hors ligne à ses applications, gardez un couloir court.',
    dailyLimit: 10_000,
    typicalTileBytes: 14_000,
  },
  opentopomap: {
    provider: 'opentopomap',
    allowed: true,
    personalUse: true,
    reason: 'Usage personnel : serveur bénévole, téléchargement plafonné à 2 000 tuiles par jour.',
    dailyLimit: 2_000,
    typicalTileBytes: 30_000,
  },
}

export function offlinePolicy(sourceId: string): OfflinePolicy {
  return (
    OFFLINE_POLICIES[sourceId] ?? {
      provider: sourceId,
      allowed: false,
      reason: 'Conditions de cette source non vérifiées pour le hors ligne.',
      typicalTileBytes: 30_000,
    }
  )
}
