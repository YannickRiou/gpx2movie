/**
 * Registry of external label sources (e.g. OpenStreetMap landmarks): each source publishes its whole list
 * under an id, and `Labels` draws the union with the climbs and waypoints. Not part of the project document.
 */
import { create } from 'zustand'
import type { LandmarkLabel } from './labelModel'

export interface LabelSourcesState {
  sources: Readonly<Record<string, readonly LandmarkLabel[]>>
}

export const useLabelSources = create<LabelSourcesState>()(() => ({ sources: {} }))

/** Replace the labels of source `id` (an empty list removes it). */
export function setLabelSource(id: string, labels: readonly LandmarkLabel[]): void {
  const sources = { ...useLabelSources.getState().sources }
  if (labels.length > 0) sources[id] = labels
  else delete sources[id]
  useLabelSources.setState({ sources })
}

/** Every registered label, sources in registration order. */
export function externalLabels(sources: LabelSourcesState['sources']): LandmarkLabel[] {
  return Object.values(sources).flat()
}
