import { OSM_ATTRIBUTION } from '../osm/overpass'
import { useLandmarkStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import { useWeatherStore } from '../weather/store'

/** French plural: zero and one take the singular. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular
}

/**
 * Tile counters, import spinner and the mandatory source attributions.
 * Only the import status is a live region: the tile counters change several times a second
 * and must not be announced by screen readers.
 */
export function StatusBar() {
  const stats = useAppStore((s) => s.terrainStats)
  const loading = useAppStore((s) => s.loading)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weatherShown = useWeatherStore((s) => s.status === 'ready')
  const landmarksShown = useLandmarkStore((s) => Object.values(s.landmarks).some((list) => list.length > 0))

  const terrain = getTerrainSource(terrainSourceId)
  const imagery = getImagerySource(imagerySourceId)

  return (
    <footer className="status">
      <p className="status__line">
        Tuiles : {stats.loadedTiles} {plural(stats.loadedTiles, 'chargée', 'chargées')} · {stats.pendingTiles} en
        attente
        {stats.failedTiles > 0 && ` · ${stats.failedTiles} en erreur`}
      </p>
      {/* always mounted so that assistive tech sees the text change */}
      <p className="status__line" role="status" aria-live="polite" hidden={!loading}>
        <span className="status__spinner" aria-hidden="true" />
        Import en cours…
      </p>
      <p className="status__attribution">
        Relief : {terrain.attribution}
        <br />
        Imagerie : {imagery.attribution}
        {weatherShown && (
          <>
            <br />
            {OPEN_METEO_ATTRIBUTION}
          </>
        )}
        {landmarksShown && (
          <>
            <br />
            Repères : {OSM_ATTRIBUTION}
          </>
        )}
      </p>
    </footer>
  )
}
