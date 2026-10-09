import { useId } from 'react'
import type { ReactNode } from 'react'
import { modifiedPaths } from '../project/apply'
import type { SettingPath } from '../project/apply'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { Icon } from './icons'
import { ModifiedMarker } from './ModifiedMarker'

/**
 * Foldable section of a tab, flat with a sticky header (title, « modifié / Par défaut » of `keys` if given, chevron).
 * Open at first; the content stays mounted when folded.
 */
export function PanelSection({
  title,
  keys,
  hidden = false,
  children,
}: {
  title: string
  keys?: (keyof Settings)[]
  hidden?: boolean
  children: ReactNode
}) {
  return (
    <details className="fold panel-section" open hidden={hidden}>
      <summary className="fold__summary">
        <h2 className="section-title fold__title">{title}</h2>
        {/* the marker's button must not fold the section */}
        {keys && (
          <span className="fold__marker" onClick={(e) => e.preventDefault()}>
            <ModifiedMarker keys={keys} label={title} />
          </span>
        )}
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="panel-section__body">{children}</div>
    </details>
  )
}

/**
 * « Plus de réglages » (or `label`): the rarely used settings of a section, folded; the summary shows « modifié » when
 * one of `paths` differs from its default.
 */
export function MoreSettings({ paths, label = 'Plus de réglages', children }: { paths: readonly SettingPath[]; label?: string; children: ReactNode }) {
  const modified = useAppStore((s) => modifiedPaths(s.settings, paths).length > 0)
  return (
    <details className="more-settings">
      <summary className="more-settings__summary">
        <Icon name="sliders-horizontal" size={16} />
        <span className="more-settings__label">{label}</span>
        {modified && <span className="modified__badge">modifié</span>}
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="more-settings__body">{children}</div>
    </details>
  )
}

/** ⓘ with a one-sentence explanation (tooltip on hover and keyboard focus, read by screen readers). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="img" aria-label={text} data-tip={text}>
      <Icon name="info" size={14} />
    </span>
  )
}

/** A slider with its label and its value written out (`wide`: room for a value with a unit). */
export function RangeField({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  disabled = false,
  wide = true,
  tip,
  spoken = format,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format(value: number): string
  onChange(value: number): void
  disabled?: boolean
  wide?: boolean
  /** explanation in an ⓘ next to the label */
  tip?: string
  /** value read by screen readers, when it differs from the displayed one */
  spoken?(value: number): string
}) {
  const id = useId()
  const labelEl = (
    <label className="field__label" htmlFor={id}>
      {label}
    </label>
  )
  return (
    <div className="field">
      {tip ? (
        <div className="field__label-row">
          {labelEl}
          <InfoTip text={tip} />
        </div>
      ) : (
        labelEl
      )}
      <div className="range-row">
        <input
          id={id}
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-valuetext={spoken(value)}
        />
        <output className={wide ? 'range-row__value range-row__value--wide' : 'range-row__value'} htmlFor={id}>
          {format(value)}
        </output>
      </div>
    </div>
  )
}
