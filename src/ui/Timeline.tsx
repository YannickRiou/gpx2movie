import { useId, useMemo, type PointerEvent } from 'react'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath, type ElevationProfile } from '../flyover/path'
import { useAppStore } from '../state/store'
import { formatDistance, formatNumber } from './format'

const SPEEDS = [0.5, 1, 2, 4]
/** Slider resolution: 1000 steps over the track. */
const PROGRESS_STEPS = 1000
/** Profile resolution (samples over the track) and drawing height in viewBox units. */
const PROFILE_SAMPLES = 400
const PROFILE_HEIGHT = 100
/** Smallest elevation range drawn full height: a flat track stays flat instead of magnifying GPS noise. */
const PROFILE_MIN_SPAN_M = 100

/** Recorded instant -> "14 h 32", in the browser time zone. */
function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`
}

/** Closed SVG area under the profile, one sub-path per run of known elevations. */
function profileAreaPath(profile: ElevationProfile): string {
  const { ele, minEle, maxEle } = profile
  const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
  let d = ''
  let runStart = -1
  for (let i = 0; i <= ele.length; i++) {
    const known = i < ele.length && !Number.isNaN(ele[i])
    if (known) {
      const y = PROFILE_HEIGHT * (1 - 0.9 * ((ele[i] - minEle) / span))
      d += runStart < 0 ? `M${i} ${PROFILE_HEIGHT}L${i} ${y.toFixed(1)}` : `L${i} ${y.toFixed(1)}`
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      d += `L${i - 1} ${PROFILE_HEIGHT}Z`
      runStart = -1
    }
  }
  return d
}

/**
 * Flyover controls over the 3D view: play / pause, elevation profile (click or drag to seek) above the
 * progress slider, distance covered, current elevation and recorded time, speed.
 */
export function Timeline() {
  const track = useAppStore((s) => s.tracks[0])
  const { playing, progress, speed } = useAppStore((s) => s.playback)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const setProgress = useAppStore((s) => s.setProgress)
  const setSpeed = useAppStore((s) => s.setSpeed)
  const id = useId()
  const clipId = `profile-played-${id.replace(/[^\w-]/g, '')}`
  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const profile = useMemo(() => (path ? elevationProfile(path, PROFILE_SAMPLES) : undefined), [path])
  const area = useMemo(() => (profile ? profileAreaPath(profile) : ''), [profile])

  if (!track || !path) return null
  const total = track.stats.distanceM
  const ele = profile && path.count > 0 ? samplePath(path, progress * path.lengthM).ele : undefined
  // startTime is set as soon as one point has a time: skips the scan of an untimed track
  const time =
    track.stats.startTime !== undefined && path.count > 0 ? recordedTimeAt(path, progress * path.lengthM) : undefined
  const width = PROFILE_SAMPLES - 1

  const seek = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width > 0) setProgress((e.clientX - rect.left) / rect.width)
  }

  return (
    <div className="timeline" role="group" aria-label={`Survol de ${track.name}`}>
      <button
        type="button"
        className="btn btn--primary timeline__play"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Mettre en pause' : 'Lancer le survol'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="timeline__scrub">
        {profile && (
          // pointer shortcut for the slider below, which stays the accessible control
          <svg
            className="timeline__profile"
            viewBox={`0 0 ${width} ${PROFILE_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              seek(e)
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) seek(e)
            }}
          >
            <clipPath id={clipId}>
              <rect width={progress * width} height={PROFILE_HEIGHT} />
            </clipPath>
            <path className="timeline__profile-area" d={area} />
            <path className="timeline__profile-played" d={area} clipPath={`url(#${clipId})`} />
            <line
              className="timeline__profile-cursor"
              x1={progress * width}
              x2={progress * width}
              y1={0}
              y2={PROFILE_HEIGHT}
            />
          </svg>
        )}
        <input
          type="range"
          className="range timeline__range"
          min={0}
          max={PROGRESS_STEPS}
          step={1}
          value={Math.round(progress * PROGRESS_STEPS)}
          onChange={(e) => setProgress(Number(e.currentTarget.value) / PROGRESS_STEPS)}
          aria-label="Progression du survol"
          aria-valuetext={formatDistance(progress * total)}
        />
      </div>
      <span className="timeline__distance">
        <strong>{formatDistance(progress * total)}</strong> / {formatDistance(total)}
        {(ele !== undefined || time !== undefined) && <br />}
        {ele !== undefined && (
          <>
            <span className="visually-hidden">Altitude : </span>
            <strong>{formatNumber(ele)} m</strong>
          </>
        )}
        {ele !== undefined && time !== undefined && ' · '}
        {time !== undefined && (
          <>
            <span className="visually-hidden">Heure enregistrée : </span>
            <time dateTime={new Date(time).toISOString()}>
              <strong>{formatClock(time)}</strong>
            </time>
          </>
        )}
      </span>
      <label className="visually-hidden" htmlFor={`${id}-speed`}>
        Vitesse
      </label>
      <select
        id={`${id}-speed`}
        className="select timeline__speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.currentTarget.value))}
      >
        {SPEEDS.map((value) => (
          <option key={value} value={value}>
            ×{formatNumber(value, value % 1 === 0 ? 0 : 1)}
          </option>
        ))}
      </select>
    </div>
  )
}
