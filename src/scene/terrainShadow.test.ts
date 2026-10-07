import { describe, expect, it } from 'vitest'
import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three'
import {
  MIN_SHADOW_DISTANCE_M,
  NORMAL_BIAS_TEXELS,
  SHADOW_DISTANCE_PER_HEIGHT,
  TerrainShadow,
  fitShadowFrustum,
  shadowDistance,
  type ShadowFit,
} from './terrainShadow'

const MAP_SIZE = 1024
/** 40 km of terrain between 1000 m and 4000 m, centred on the origin */
const TERRAIN = new Box3(new Vector3(-20_000, 1000, -20_000), new Vector3(20_000, 4000, 20_000))

function viewCamera(position: Vector3, lookAt: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1.5, 1, 5e6)
  camera.position.copy(position)
  camera.lookAt(lookAt)
  camera.updateMatrixWorld()
  return camera
}

/** World → light view matrix of a sun shining from `towardsSun` (looking down -Z, like three's shadow camera). */
function lightView(towardsSun: Vector3): Matrix4 {
  const camera = new OrthographicCamera()
  camera.position.copy(towardsSun).normalize()
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera.matrixWorldInverse
}

function fit(camera: PerspectiveCamera, towardsSun: Vector3, maxDistance = 1e7, box = TERRAIN): ShadowFit | null {
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  const forward = camera.getWorldDirection(new Vector3())
  return fitShadowFrustum(frustum, camera.position, forward, maxDistance, box, lightView(towardsSun), MAP_SIZE)
}

/** Light-space AABB of a box's corners. */
function lightSpaceBounds(box: Box3, towardsSun: Vector3) {
  const view = lightView(towardsSun)
  const out = new Box3()
  for (let c = 0; c < 8; c++) {
    const { min, max } = box
    out.expandByPoint(new Vector3(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z).applyMatrix4(view))
  }
  return out
}

const HIGH_SUN = new Vector3(0.3, 1, 0.2)
const LOW_SUN = new Vector3(-1, 0.03, 0.2) // ~1.7° above the western horizon

describe('shadowDistance', () => {
  it('never goes below the minimum, then grows with the camera height above the terrain', () => {
    expect(shadowDistance(1500, 1000)).toBe(MIN_SHADOW_DISTANCE_M)
    expect(shadowDistance(41_000, 1000)).toBe(SHADOW_DISTANCE_PER_HEIGHT * 40_000)
  })
})

describe('fitShadowFrustum', () => {
  it('covers the whole terrain when the camera sees all of it, snapped and padded', () => {
    const camera = viewCamera(new Vector3(0, 120_000, 1), new Vector3(0, 0, 0))
    const result = fit(camera, HIGH_SUN)!
    const expected = lightSpaceBounds(TERRAIN, HIGH_SUN)
    expect(result.left).toBeLessThanOrEqual(expected.min.x)
    expect(result.right).toBeGreaterThanOrEqual(expected.max.x)
    expect(result.bottom).toBeLessThanOrEqual(expected.min.y)
    expect(result.top).toBeGreaterThanOrEqual(expected.max.y)
    // quantised up by at most one 2^(1/8) step plus the padding
    expect(result.right - result.left).toBeLessThan((expected.max.x - expected.min.x) * 1.1 + 4 * result.texelSize)
    // the light view looks down -Z: the box lies between near and far
    expect(result.near).toBeLessThanOrEqual(-expected.max.z)
    expect(result.far).toBeGreaterThanOrEqual(-expected.min.z)
    // whole texels
    const texelX = (result.right - result.left) / MAP_SIZE
    expect(Math.abs(result.left / texelX - Math.round(result.left / texelX))).toBeLessThan(1e-6)
  })

  it('shrinks to the part of the terrain in view, cut at maxDistance', () => {
    // low camera at the south edge looking north, as in the flyover chase
    const camera = viewCamera(new Vector3(0, 3000, 19_000), new Vector3(0, 1500, 15_000))
    const full = fit(camera, HIGH_SUN)!
    const near = fit(camera, HIGH_SUN, 8000)!
    const all = lightSpaceBounds(TERRAIN, HIGH_SUN)
    expect(full.right - full.left).toBeLessThan(all.max.x - all.min.x)
    expect(near.right - near.left).toBeLessThan(full.right - full.left)
    expect(near.texelSize).toBeLessThan(full.texelSize)
    expect(near.texelSize).toBeLessThan(16_000 / MAP_SIZE)
  })

  it('reaches the casters between the view and a low sun', () => {
    // looking east, away from a western sun: the ridges to the west are behind the camera
    const camera = viewCamera(new Vector3(0, 2500, 0), new Vector3(5000, 1500, 0))
    const result = fit(camera, LOW_SUN, 10_000)!
    const all = lightSpaceBounds(TERRAIN, LOW_SUN)
    expect(result.near).toBeLessThanOrEqual(-all.max.z)
  })

  it('returns null when no terrain is in view', () => {
    const camera = viewCamera(new Vector3(0, 10_000, 0), new Vector3(0, 20_000, 1))
    expect(fit(camera, HIGH_SUN)).toBeNull()
    expect(fit(camera, HIGH_SUN, 1e7, new Box3())).toBeNull()
  })

  it('keeps the same bounds for a camera move smaller than a texel', () => {
    const a = fit(viewCamera(new Vector3(0, 60_000, 30_000), new Vector3(0, 0, 0)), HIGH_SUN)!
    const b = fit(viewCamera(new Vector3(0.5, 60_000, 30_000), new Vector3(0.5, 0, 0)), HIGH_SUN)!
    expect(b.right - b.left).toBe(a.right - a.left)
    expect(b.top - b.bottom).toBe(a.top - a.bottom)
  })
})

describe('TerrainShadow', () => {
  function scene() {
    const terrain = new Group()
    const geometry = new BoxGeometry(10_000, 2000, 10_000).translate(0, 2000, 0)
    geometry.computeBoundingBox()
    terrain.add(new Mesh(geometry))
    const light = new DirectionalLight()
    light.position.copy(HIGH_SUN).normalize()
    light.updateMatrixWorld()
    light.target.updateMatrixWorld()
    const camera = viewCamera(new Vector3(0, 30_000, 20_000), new Vector3(0, 2000, 0))
    return { terrain, light, camera }
  }

  it('fits its camera and biases to the visible terrain when the renderer updates it', () => {
    const { terrain, light, camera } = scene()
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    shadow.updateMatrices(light, camera)
    const ortho = shadow.camera
    const width = ortho.right - ortho.left
    expect(width).toBeGreaterThan(10_000)
    expect(width).toBeLessThan(20_000)
    expect(shadow.normalBias).toBeCloseTo((NORMAL_BIAS_TEXELS * Math.max(width, ortho.top - ortho.bottom)) / MAP_SIZE)
    expect(shadow.bias).toBeLessThan(0)
    expect(shadow.mapSize.x).toBe(MAP_SIZE)
  })

  it('leaves the default projection when no terrain mesh is visible', () => {
    const { terrain, light, camera } = scene()
    terrain.children[0].visible = false
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    const before = shadow.camera.right
    shadow.updateMatrices(light, camera)
    expect(shadow.camera.right).toBe(before)
  })
})
