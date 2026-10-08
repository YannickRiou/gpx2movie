import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { hasMetric } from '../flyover/trackColor'
import { fileToLogoDataUrl } from '../overlay/assets'
import {
  COUNTER_IDS,
  CREDITS_POSITIONS,
  END_START_MAX,
  END_START_MIN,
  OVERLAY_ANCHORS,
  OVERLAY_ANCHOR_LABELS,
  OVERLAY_STYLES,
  OVERLAY_STYLE_LABELS,
  PROFILE_HEIGHT_MAX,
  PROFILE_HEIGHT_MIN,
  PROFILE_WIDTH_MAX,
  PROFILE_WIDTH_MIN,
  TITLE_END_MAX,
  TITLE_END_MIN,
  WIDGET_SIZE_MAX,
  WIDGET_SIZE_MIN,
} from '../overlay/settings'
import type { CounterId, CreditsPosition, OverlayAnchor, OverlaySettings } from '../overlay/settings'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { formatNumber } from './format'
import { InfoTip, PanelSection } from './PanelSection'

const COUNTER_LABELS: Record<CounterId, string> = {
  distance: 'Distance',
  altitude: 'Altitude',
  ascent: 'Dénivelé positif',
  time: 'Temps écoulé',
  speed: 'Vitesse',
  heartRate: 'Fréquence cardiaque',
}

type WidgetKey = Exclude<keyof OverlaySettings, 'enabled' | 'style'>

const percent = (v: number) => `${formatNumber(v * 100)} %`

interface RangeFieldProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  format(value: number): string
  onChange(value: number): void
}

function RangeField({ label, min, max, step, value, format, onChange }: RangeFieldProps) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="range-row">
        <input
          id={id}
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-valuetext={format(value)}
        />
        <output className="range-row__value range-row__value--wide" htmlFor={id}>
          {format(value)}
        </output>
      </div>
    </div>
  )
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange(v: string): void }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  )
}

function AnchorField({ value, onChange }: { value: OverlayAnchor; onChange(v: OverlayAnchor): void }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Position
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.currentTarget.value as OverlayAnchor)}>
        {OVERLAY_ANCHORS.map((anchor) => (
          <option key={anchor} value={anchor}>
            {OVERLAY_ANCHOR_LABELS[anchor]}
          </option>
        ))}
      </select>
    </div>
  )
}

const SizeField = ({ value, onChange }: { value: number; onChange(v: number): void }) => (
  <RangeField label="Taille" min={WIDGET_SIZE_MIN} max={WIDGET_SIZE_MAX} step={0.1} value={value} format={(v) => `×${formatNumber(v, 1)}`} onChange={onChange} />
)

/** One widget: a checkbox that shows its options while it is enabled. */
function WidgetGroup({ label, enabled, onToggle, children }: { label: string; enabled: boolean; onToggle(v: boolean): void; children: ReactNode }) {
  const id = useId()
  return (
    <div className="overlay-widget" role="group" aria-labelledby={id}>
      <label className="checkbox checkbox--switch" id={id}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.currentTarget.checked)} />
        {label}
      </label>
      {enabled && <div className="overlay-widget__body">{children}</div>}
    </div>
  )
}

/**
 * « Habillage » tab, in sections: Habillage (on / off, style; « modifié / Par défaut » of the whole overlay), Titres,
 * Compteurs, Profil et mini-carte, Météo, logo et texte, and Crédits des sources (burned in even without the rest).
 */
export function OverlayPanel() {
  const overlay = useAppStore((s) => s.settings.overlay)
  const setSetting = useAppStore((s) => s.setSetting)
  const track = useAppStore((s) => s.tracks[0])
  const hasWeather = useWeatherStore((s) => s.series !== null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const id = useId()

  const set = (patch: Partial<OverlaySettings>) => setSetting('overlay', { ...overlay, ...patch })
  const setWidget = <K extends WidgetKey>(key: K, patch: Partial<OverlaySettings[K]>) => set({ [key]: { ...overlay[key], ...patch } })

  const hasTime = track?.stats.startTime !== undefined
  const hasEle = track?.stats.maxEle !== undefined
  const available: Record<CounterId, boolean> = {
    distance: true,
    altitude: !track || hasEle,
    ascent: !track || hasEle,
    time: !track || hasTime,
    speed: !track || hasMetric(track, 'speed'),
    heartRate: !track || hasMetric(track, 'heartRate'),
  }

  const chooseLogo = async () => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] })
      if (!file) return
      setLogoError(null)
      setWidget('logo', { image: await fileToLogoDataUrl(file) })
    } catch {
      setLogoError("Cette image n'a pas pu être lue.")
    }
  }

  return (
    <>
      <PanelSection title="Habillage" keys={['overlay']}>
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={overlay.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} />
          Afficher l'habillage
        </label>
        <p className="field__hint">Titres, compteurs et profil incrustés dans le film, tels qu'exportés.</p>

        {overlay.enabled && (
          <fieldset className="field fieldset">
            <legend className="field__label">Style</legend>
            <div className="segmented">
              {OVERLAY_STYLES.map((style) => (
                <label key={style} className="segmented__option">
                  <input
                    type="radio"
                    name={`${id}-style`}
                    value={style}
                    checked={overlay.style === style}
                    onChange={() => set({ style })}
                  />
                  {OVERLAY_STYLE_LABELS[style]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </PanelSection>

      {overlay.enabled && (
        <>
          <PanelSection title="Titres">
            <WidgetGroup label="Titre d'ouverture" enabled={overlay.title.enabled} onToggle={(enabled) => setWidget('title', { enabled })}>
              <TextField label="Titre" value={overlay.title.title} placeholder={track?.name ?? 'Nom de la trace'} onChange={(title) => setWidget('title', { title })} />
              <TextField label="Sous-titre" value={overlay.title.subtitle} placeholder="Lieu, occasion…" onChange={(subtitle) => setWidget('title', { subtitle })} />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overlay.title.showDate && hasTime}
                  disabled={!hasTime}
                  onChange={(e) => setWidget('title', { showDate: e.currentTarget.checked })}
                />
                Date de la sortie
              </label>
              <RangeField
                label="Durée d'affichage"
                min={TITLE_END_MIN}
                max={TITLE_END_MAX}
                step={0.01}
                value={overlay.title.end}
                format={(v) => `${percent(v)} du survol`}
                onChange={(end) => setWidget('title', { end })}
              />
              <AnchorField value={overlay.title.anchor} onChange={(anchor) => setWidget('title', { anchor })} />
              <SizeField value={overlay.title.size} onChange={(size) => setWidget('title', { size })} />
            </WidgetGroup>

            <WidgetGroup label="Carte de clôture" enabled={overlay.end.enabled} onToggle={(enabled) => setWidget('end', { enabled })}>
              <TextField label="Titre" value={overlay.end.title} placeholder={track?.name ?? 'Nom de la trace'} onChange={(title) => setWidget('end', { title })} />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overlay.end.showWeather && hasWeather}
                  disabled={!hasWeather}
                  onChange={(e) => setWidget('end', { showWeather: e.currentTarget.checked })}
                />
                Météo de la sortie
              </label>
              <RangeField
                label="Apparition"
                min={END_START_MIN}
                max={END_START_MAX}
                step={0.01}
                value={overlay.end.start}
                format={(v) => `à ${percent(v)} du survol`}
                onChange={(start) => setWidget('end', { start })}
              />
              <AnchorField value={overlay.end.anchor} onChange={(anchor) => setWidget('end', { anchor })} />
              <SizeField value={overlay.end.size} onChange={(size) => setWidget('end', { size })} />
            </WidgetGroup>
          </PanelSection>

          <PanelSection title="Compteurs">
            <WidgetGroup label="Afficher les compteurs" enabled={overlay.counters.enabled} onToggle={(enabled) => setWidget('counters', { enabled })}>
              <fieldset className="field fieldset">
                <legend className="field__label">Valeurs</legend>
                <div className="chips">
                  {COUNTER_IDS.map((counter) => (
                    <label key={counter} className="chip" title={available[counter] ? undefined : 'Absent de cette trace'}>
                      <input
                        type="checkbox"
                        checked={overlay.counters.fields[counter] && available[counter]}
                        disabled={!available[counter]}
                        onChange={(e) => setWidget('counters', { fields: { ...overlay.counters.fields, [counter]: e.currentTarget.checked } })}
                      />
                      {COUNTER_LABELS[counter]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <AnchorField value={overlay.counters.anchor} onChange={(anchor) => setWidget('counters', { anchor })} />
              <SizeField value={overlay.counters.size} onChange={(size) => setWidget('counters', { size })} />
            </WidgetGroup>
          </PanelSection>

          <PanelSection title="Profil et mini-carte">
            <WidgetGroup label="Profil altimétrique" enabled={overlay.profile.enabled} onToggle={(enabled) => setWidget('profile', { enabled })}>
              {!hasEle && track && <p className="field__hint">Cette trace n'a pas d'altitude enregistrée.</p>}
              <RangeField
                label="Largeur (% de l'image)"
                min={PROFILE_WIDTH_MIN}
                max={PROFILE_WIDTH_MAX}
                step={0.01}
                value={overlay.profile.width}
                format={percent}
                onChange={(width) => setWidget('profile', { width })}
              />
              <RangeField
                label="Hauteur (% de l'image)"
                min={PROFILE_HEIGHT_MIN}
                max={PROFILE_HEIGHT_MAX}
                step={0.01}
                value={overlay.profile.height}
                format={percent}
                onChange={(height) => setWidget('profile', { height })}
              />
              <AnchorField value={overlay.profile.anchor} onChange={(anchor) => setWidget('profile', { anchor })} />
            </WidgetGroup>

            <WidgetGroup label="Mini-carte" enabled={overlay.minimap.enabled} onToggle={(enabled) => setWidget('minimap', { enabled })}>
              <p className="field__hint">Tout le tracé vu de dessus, nord en haut, avec la position.</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overlay.minimap.northArrow}
                  onChange={(e) => setWidget('minimap', { northArrow: e.currentTarget.checked })}
                />
                Flèche du nord
              </label>
              <AnchorField value={overlay.minimap.anchor} onChange={(anchor) => setWidget('minimap', { anchor })} />
              <SizeField value={overlay.minimap.size} onChange={(size) => setWidget('minimap', { size })} />
            </WidgetGroup>
          </PanelSection>

          <PanelSection title="Météo, logo et texte">
            <WidgetGroup label="Météo" enabled={overlay.weather.enabled} onToggle={(enabled) => setWidget('weather', { enabled })}>
              <p className="field__hint">
                {hasWeather
                  ? 'Ciel, température et vent au marqueur.'
                  : 'Disponible quand la météo de la sortie est chargée (onglet Trace).'}
              </p>
              <AnchorField value={overlay.weather.anchor} onChange={(anchor) => setWidget('weather', { anchor })} />
              <SizeField value={overlay.weather.size} onChange={(size) => setWidget('weather', { size })} />
            </WidgetGroup>

            <WidgetGroup label="Logo" enabled={overlay.logo.enabled} onToggle={(enabled) => setWidget('logo', { enabled })}>
              <div className="project__row">
                <button type="button" className="btn btn--secondary" onClick={() => void chooseLogo()}>
                  {overlay.logo.image ? "Changer l'image" : 'Choisir une image'}
                </button>
                {overlay.logo.image && (
                  <button type="button" className="btn btn--secondary" onClick={() => setWidget('logo', { image: '' })}>
                    Retirer
                  </button>
                )}
              </div>
              {logoError && (
                <p className="field__hint" role="alert">
                  {logoError}
                </p>
              )}
              <AnchorField value={overlay.logo.anchor} onChange={(anchor) => setWidget('logo', { anchor })} />
              <SizeField value={overlay.logo.size} onChange={(size) => setWidget('logo', { size })} />
            </WidgetGroup>

            <WidgetGroup label="Texte libre" enabled={overlay.text.enabled} onToggle={(enabled) => setWidget('text', { enabled })}>
              <TextField label="Texte" value={overlay.text.text} placeholder="Ex. : avec Marie et Paul" onChange={(text) => setWidget('text', { text })} />
              <AnchorField value={overlay.text.anchor} onChange={(anchor) => setWidget('text', { anchor })} />
              <SizeField value={overlay.text.size} onChange={(size) => setWidget('text', { size })} />
            </WidgetGroup>
          </PanelSection>
        </>
      )}

      <PanelSection title="Crédits des sources">
        <div className="field__label-row">
          <label className="checkbox checkbox--switch">
            <input type="checkbox" checked={overlay.credits.enabled} onChange={(e) => setWidget('credits', { enabled: e.currentTarget.checked })} />
            Incruster les crédits
          </label>
          <InfoTip text="Les licences du relief, de l'imagerie, de la météo et d'OpenStreetMap demandent de citer les sources dans le film publié." />
        </div>
        {overlay.credits.enabled ? (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-credits`}>
              Position
            </label>
            <select
              id={`${id}-credits`}
              className="select"
              value={overlay.credits.position}
              onChange={(e) => setWidget('credits', { position: e.currentTarget.value as CreditsPosition })}
            >
              {CREDITS_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {OVERLAY_ANCHOR_LABELS[position]}
                </option>
              ))}
            </select>
            <p className="field__hint">En petit, dans chaque image exportée, même sans le reste de l'habillage.</p>
          </div>
        ) : (
          <p className="field__hint">Citez alors les sources ailleurs (description de la vidéo, générique).</p>
        )}
      </PanelSection>
    </>
  )
}
