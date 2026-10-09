/**
 * Colour grading in the scene (`settings.grading`): the same post-effect in both render paths.
 *
 * - With the atmosphere, `AtmosphereLayer` appends the effect of `useGradingEffect` at the end of its composer
 *   (after the tone mapping and the SMAA, which reads the pass input and would skip an effect placed before it).
 * - Without the atmosphere there is no composer: `GradingComposer` adds a minimal one (render, SMAA, grading) only
 *   while the grading changes something or an « Objectif » effect is on (scene/useLensEffects.ts, the lens flare
 *   excepted: it needs the sun of the atmosphere). The grading then also lays the image over the CSS sky gradient, so
 *   that the sky is graded and the export, which draws the same gradient under the canvas, gets the same image.
 *
 * « Naturel » (identity) mounts nothing: no extra pass, no shader, no render target.
 */
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { EffectComposer, SMAA } from '@react-three/postprocessing'
import { useAppStore } from '../state/store'
import { isIdentityGrading } from './grading'
import { GradingEffect, type GradingEffectOptions } from './gradingEffect'
import { useLensEffects } from './useLensEffects'

/** The grading effect kept in sync with the settings, and whether it changes the image (else leave it unmounted). */
export function useGradingEffect(options?: GradingEffectOptions): { effect: GradingEffect; active: boolean } {
  const grading = useAppStore((s) => s.settings.grading)
  const top = options?.skyBackdrop?.top
  const horizon = options?.skyBackdrop?.horizon
  const effect = useMemo(
    () => new GradingEffect(top !== undefined && horizon !== undefined ? { skyBackdrop: { top, horizon } } : {}),
    [top, horizon],
  )
  useEffect(() => () => effect.dispose(), [effect])
  useLayoutEffect(() => effect.setGrading(grading), [effect, grading])
  return { effect, active: !isIdentityGrading(grading) }
}

/** Grading and lens effects without the atmosphere: a composer of their own, over the CSS sky gradient of the canvas. */
export function GradingComposer({ skyTop, skyHorizon }: { skyTop: string; skyHorizon: string }) {
  const { effect, active } = useGradingEffect({ skyBackdrop: { top: skyTop, horizon: skyHorizon } })
  const lens = useLensEffects()
  if (!active && lens.effects.length === 0 && !lens.shutter) return null
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      {lens.effects.map((e) => (
        <primitive key={e.name} object={e} />
      ))}
      {/* also with « Naturel »: it lays the image over the sky gradient (opaque output under the lens effects) */}
      <primitive object={effect} />
      {lens.shutter && <primitive object={lens.shutter} />}
    </EffectComposer>
  )
}
