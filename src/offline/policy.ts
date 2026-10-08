/**
 * Which tile sources may be downloaded ahead for offline use, read from each provider's terms (October 2026, links
 * and reasons in README, « Sources de données »). A source missing from this table is refused.
 */

export interface OfflinePolicy {
  /** sources of one provider share its daily limit */
  provider: string
  allowed: boolean
  /** why (shown when refused) */
  reason: string
  /** tiles per day and per device at most; absent = no limit beyond the polite pace */
  dailyLimit?: number
  /** average tile size measured around Chamonix (bytes), for the estimate */
  typicalTileBytes: number
}

const IGN = { provider: 'ign', allowed: true, reason: 'Licence ouverte Etalab 2.0', dailyLimit: 50_000 } as const
const SWISSTOPO_REASON =
  'swisstopo demande d’éviter les téléchargements automatiques en masse et réserve les usages hors ligne à son service de téléchargement.'

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
  swisstopo: { provider: 'swisstopo', allowed: false, reason: SWISSTOPO_REASON, typicalTileBytes: 20_000 },
  'swisstopo-carte': { provider: 'swisstopo', allowed: false, reason: SWISSTOPO_REASON, typicalTileBytes: 30_000 },
  'arcgis-world-imagery': {
    provider: 'esri',
    allowed: false,
    reason: 'Esri réserve l’usage hors ligne de World Imagery à ses propres applications (service « for Export », compte ArcGIS).',
    typicalTileBytes: 14_000,
  },
  opentopomap: {
    provider: 'opentopomap',
    allowed: false,
    reason: 'Serveur bénévole : OpenTopoMap demande de ne pas le charger par des téléchargements en masse.',
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
