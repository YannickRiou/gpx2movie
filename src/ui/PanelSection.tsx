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
export function PanelSection({ title, keys, children }: { title: string; keys?: (keyof Settings)[]; children: ReactNode }) {
  return (
    <details className="fold panel-section" open>
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
