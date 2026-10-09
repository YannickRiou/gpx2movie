import { errorMessage } from '../core/errors'
import { useId, useMemo, useState } from 'react'
import { trackPathOf } from '../flyover/path'
import { autoDistanceM } from '../flyover/camera'
import { offlinePolicy } from '../offline/policy'
import { CORRIDOR_WIDTHS_M, MAX_PACK_TILES, planOfflineTiles } from '../offline/plan'
import { cancelPack, deletePack, pausePack, preparePack, resumePack, useOfflineStore } from '../offline/store'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { formatNumber } from './format'
import { showToast } from './toast'

/** bytes -> "420 Mo", "1,2 Go" */
function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${formatNumber(bytes / 1e9, 1)} Go` : `${formatNumber(Math.max(bytes, 0) / 1e6)} Mo`
}

/** « Hors ligne » (Trace tab): estimate, download and list of the offline tile packs. */
export function OfflinePanel() {
  const id = useId()
  const tracks = useAppStore((s) => s.tracks)
  const bounds = useAppStore((s) => s.bounds)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const imageryZoomOffset = useAppStore((s) => s.settings.imageryZoomOffset)
  const camera = useAppStore((s) => s.settings.camera)
  const { packs, job, usage } = useOfflineStore()
  const [corridorM, setCorridorM] = useState<number>(CORRIDOR_WIDTHS_M[0])
  const canStore = getPlatform().tileCache !== null

  const terrain = getTerrainSource(terrainSourceId)
  const imagery = getImagerySource(imagerySourceId)
  const terrainPolicy = offlinePolicy(terrain.id)
  const imageryPolicy = offlinePolicy(imagery.id)

  const plan = useMemo(() => {
    if (!bounds || tracks.length === 0 || !terrainPolicy.allowed) return null
    // the follow camera at its lowest: distance of the shortest track × setting × sin(pitch)
    const distanceM = Math.min(...tracks.map((t) => autoDistanceM(trackPathOf(t)))) * camera.distance
    return planOfflineTiles({
      points: tracks.flatMap((t) => t.segments.flatMap((s) => s.points)),
      bounds,
      corridorM,
      terrain,
      imagery: imageryPolicy.allowed ? imagery : null,
      imageryZoomOffset,
      cameraHeightM: distanceM * Math.sin((camera.pitchDeg * Math.PI) / 180),
    })
  }, [tracks, bounds, corridorM, terrain, imagery, imageryZoomOffset, camera.distance, camera.pitchDeg, terrainPolicy.allowed, imageryPolicy.allowed])

  const tooBig = plan !== null && plan.tiles.length > MAX_PACK_TILES

  const prepare = async () => {
    if (!plan) return
    const name = tracks.length === 1 ? tracks[0].name : `${tracks[0].name} et ${tracks.length - 1} autre(s)`
    try {
      const result = await preparePack({ plan, name, terrain, imagery: imageryPolicy.allowed ? imagery : null, corridorM })
      if (result.state === 'done') {
        showToast(
          result.failed > 0
            ? { kind: 'error', text: `Hors ligne : ${formatNumber(result.failed)} tuiles en échec. Relancez pour les reprendre.` }
            : { kind: 'success', text: `Prêt hors ligne : ${name}` },
        )
      } else if (result.state === 'limited') {
        showToast({ kind: 'error', text: 'Limite du jour atteinte pour cette source. Relancez demain pour finir.' })
      } else if (result.state === 'failed') {
        showToast({ kind: 'error', text: `Préparation arrêtée. ${result.error ?? ''}` })
      }
    } catch (err) {
      showToast({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <section className="settings offline" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className="field__hint">
        Téléchargez une fois les tuiles de la trace : la vue et l’export marchent ensuite sans connexion.
      </p>

      {!canStore ? (
        <p className="tracks__empty">Ce navigateur ne peut pas garder de tuiles (page non sécurisée, sans HTTPS).</p>
      ) : (
        <>
          <fieldset className="field fieldset" disabled={job !== null}>
            <legend className="field__label">Largeur du couloir</legend>
            <div className="segmented">
              {CORRIDOR_WIDTHS_M.map((width) => (
                <label key={width} className="segmented__option">
                  <input
                    type="radio"
                    name={`${id}-corridor`}
                    value={width}
                    checked={corridorM === width}
                    onChange={() => setCorridorM(width)}
                  />
                  {width / 1000} km
                </label>
              ))}
            </div>
          </fieldset>

          <p className="field__hint">
            Relief : {terrain.name}
            {terrainPolicy.allowed
              ? terrainPolicy.personalUse
                ? ` — ${terrainPolicy.reason}`
                : ''
              : ` — non téléchargeable. ${terrainPolicy.reason}`}
            <br />
            Imagerie : {imagery.name}
            {imageryPolicy.allowed
              ? imageryPolicy.personalUse
                ? ` — ${imageryPolicy.reason}`
                : ''
              : ` — non incluse, elle restera en ligne. ${imageryPolicy.reason} Pour l’inclure : IGN ou Sentinel-2 (EOX), onglet Carte.`}
          </p>

          {plan && (
            <p className="field__hint">
              Estimation : {formatNumber(plan.tiles.length)} tuiles, environ {formatSize(plan.estimatedBytes)} (détail fin
              jusqu’au niveau {plan.maxTerrainZoom}, pour une vidéo 1080p).
              {tooBig && ' Trop de tuiles : choisissez un couloir plus étroit.'}
            </p>
          )}

          {job ? (
            <div className="field">
              <progress className="export__progress" value={job.progress.done} max={Math.max(1, job.progress.total)} />
              <p className="field__hint">
                {formatNumber(job.progress.done)} / {formatNumber(job.progress.total)} tuiles · {formatSize(job.progress.bytes)}
                {job.progress.state === 'paused' ? ' · en pause' : ''}
              </p>
              <div className="project__row">
                {job.progress.state === 'paused' ? (
                  <button type="button" className="btn btn--secondary" onClick={resumePack}>
                    Reprendre
                  </button>
                ) : (
                  <button type="button" className="btn btn--secondary" onClick={pausePack}>
                    Pause
                  </button>
                )}
                <button type="button" className="btn btn--secondary" onClick={cancelPack}>
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void prepare()} disabled={!plan || tooBig}>
              Préparer hors ligne
            </button>
          )}

          {packs.length > 0 && (
            <ul className="offline__packs">
              {packs.map((pack) => (
                <li key={pack.id} className="project__row">
                  <span>
                    {pack.name}
                    <br />
                    <span className="field__hint">
                      {new Date(pack.createdAt).toLocaleDateString('fr-FR')} · {formatNumber(pack.tiles)} tuiles ·{' '}
                      {formatSize(pack.bytes)}
                      {pack.complete ? '' : ' · incomplet'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => void deletePack(pack.id)}
                    disabled={job?.packId === pack.id}
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
          {packs.some((p) => !p.complete) && (
            <p className="field__hint">Un pack incomplet se termine en relançant « Préparer hors ligne » avec la même trace et les mêmes réglages.</p>
          )}
          {usage && usage.quotaBytes > 0 && (
            <p className="field__hint">
              Espace utilisé par le site : {formatSize(usage.usedBytes)} sur {formatSize(usage.quotaBytes)} permis par le navigateur.
            </p>
          )}
        </>
      )}
    </section>
  )
}
