/**
 * Cast shadows of the relief under the atmosphere's sun (a DirectionalLight).
 *
 * One shadow map, refitted every frame to the part of the scene that can receive a visible shadow: the view frustum
 * cut at a distance that grows with the camera height, intersected with the bounding box of the drawn terrain meshes.
 * Its near plane is pushed towards the sun so a ridge outside the view still casts into it (the terrain engine keeps
 * those ready tiles visible for that purpose; three culls them from the main pass). The ortho bounds are quantised and
 * snapped to whole texels so the shadows do not shimmer when the camera moves.
 * `fitShadowFrustum` and `shadowDistance` are pure and unit-tested.
 */
import { Box3, Frustum, LightShadow, Matrix4, OrthographicCamera, Plane, Vector3 } from 'three'
import type { Camera, Light, Mesh, Object3D } from 'three'

/** Shadow map resolution (texels per side), clamped to the GPU limit. */
export const SHADOW_MAP_SIZE = 4096
/** Shadows are computed at least this far from the camera (metres)... */
export const MIN_SHADOW_DISTANCE_M = 30_000
/** ...and up to this many times the camera height above the lowest terrain (overview: the whole area). */
export const SHADOW_DISTANCE_PER_HEIGHT = 5
/** Normal offset of the shadow lookup, in shadow texels (hides the acne of slopes grazed by a low sun). */
export const NORMAL_BIAS_TEXELS = 1.5
/** Constant depth offset of the shadow lookup (metres). */
export const DEPTH_BIAS_M = 2
/** PCF filter radius (texels): soft edges of a few metres, about the penumbra of a ridge a kilometre away. */
export const SHADOW_RADIUS = 2
/** Ortho extents grow by steps of 2^(1/8) (~9 %) so the texel size only changes when the region really does. */
const EXTENT_STEPS_PER_OCTAVE = 8

export interface ShadowFit {
  left: number
  right: number
  bottom: number
  top: number
  near: number
  far: number
  /** largest side of a shadow texel (metres) */
  texelSize: number
}

/** How far from the camera shadows are drawn: a few camera heights, never less than MIN_SHADOW_DISTANCE_M. */
export function shadowDistance(cameraY: number, terrainMinY: number): number {
  return Math.max(MIN_SHADOW_DISTANCE_M, SHADOW_DISTANCE_PER_HEIGHT * (cameraY - terrainMinY))
}

const EPSILON_M = 1e-3
const _planes: Plane[] = Array.from({ length: 12 }, () => new Plane())
const _point = new Vector3()
const _cross = new Vector3()
const _corner = new Vector3()

/** Smallest 2^(k/8) >= value (value > 0). */
function quantizeUp(value: number): number {
  return 2 ** (Math.ceil(Math.log2(value) * EXTENT_STEPS_PER_OCTAVE) / EXTENT_STEPS_PER_OCTAVE)
}

/** Snap [min, max] to a quantised width aligned on whole texels; returns [start, width]. */
function snapRange(min: number, max: number, mapSize: number): [number, number] {
  // the padding covers the up-to-one-texel shift of the snapped start (see quantizeUp: <= 9 % growth)
  const width = quantizeUp(Math.max(max - min, 1) * (1 + 2 / mapSize))
  const texel = width / mapSize
  return [Math.floor(min / texel) * texel, width]
}

/** Intersection point of three planes, or false when two of them are (nearly) parallel. */
function intersectPlanes(a: Plane, b: Plane, c: Plane, target: Vector3): boolean {
  const det = a.normal.dot(_cross.crossVectors(b.normal, c.normal))
  if (Math.abs(det) < 1e-9) return false
  // p = (-da (nb x nc) - db (nc x na) - dc (na x nb)) / det, with n.p + d = 0
  target.copy(_cross).multiplyScalar(-a.constant)
  target.addScaledVector(_cross.crossVectors(c.normal, a.normal), -b.constant)
  target.addScaledVector(_cross.crossVectors(a.normal, b.normal), -c.constant)
  target.divideScalar(det)
  return true
}

/**
 * Ortho bounds, in the light's view space (`lightView` = world → light view, looking down -Z), covering
 * the receivers (view `frustum` ∩ half-space `forward·(p − eye) <= maxDistance` ∩ `terrainBox`) and the casters
 * (the whole terrain box towards the light). Null when the view does not see any terrain.
 *
 * The receiver region is a convex polytope bounded by 12 planes (the frustum without its far plane, the
 * distance cut, the six box faces); its vertices are the triple plane intersections inside every plane.
 */
export function fitShadowFrustum(
  frustum: Frustum,
  eye: Vector3,
  forward: Vector3,
  maxDistance: number,
  terrainBox: Box3,
  lightView: Matrix4,
  mapSize: number,
): ShadowFit | null {
  if (terrainBox.isEmpty()) return null
  // three's Frustum planes: 0..3 sides, 4 far, 5 near; normals point inwards (n.p + d >= 0 inside)
  for (let i = 0; i < 4; i++) _planes[i].copy(frustum.planes[i])
  _planes[4].copy(frustum.planes[5])
  _planes[5].set(_point.copy(forward).negate(), forward.dot(eye) + maxDistance)
  const { min, max } = terrainBox
  _planes[6].set(_point.set(1, 0, 0), -min.x)
  _planes[7].set(_point.set(-1, 0, 0), max.x)
  _planes[8].set(_point.set(0, 1, 0), -min.y)
  _planes[9].set(_point.set(0, -1, 0), max.y)
  _planes[10].set(_point.set(0, 0, 1), -min.z)
  _planes[11].set(_point.set(0, 0, -1), max.z)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  const n = _planes.length
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        if (!intersectPlanes(_planes[i], _planes[j], _planes[k], _point)) continue
        let inside = true
        for (let p = 0; p < n && inside; p++) inside = _planes[p].distanceToPoint(_point) >= -EPSILON_M
        if (!inside) continue
        _point.applyMatrix4(lightView)
        if (_point.x < minX) minX = _point.x
        if (_point.x > maxX) maxX = _point.x
        if (_point.y < minY) minY = _point.y
        if (_point.y > maxY) maxY = _point.y
        if (_point.z < minZ) minZ = _point.z
      }
    }
  }
  if (minX > maxX) return null

  // casters: anything of the terrain box between the receivers and the sun
  let maxZ = -Infinity
  for (let c = 0; c < 8; c++) {
    _corner.set(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z).applyMatrix4(lightView)
    if (_corner.z > maxZ) maxZ = _corner.z
  }

  const [left, width] = snapRange(minX, maxX, mapSize)
  const [bottom, height] = snapRange(minY, maxY, mapSize)
  return {
    left,
    right: left + width,
    bottom,
    top: bottom + height,
    // view space looks down -Z: near/far are distances along -Z, with a metre of slack on both ends
    near: -maxZ - 1,
    far: -minZ + 1,
    texelSize: Math.max(width, height) / mapSize,
  }
}

// ---------------------------------------------------------------------------
// Light shadow
// ---------------------------------------------------------------------------

const _frustum = new Frustum()
const _viewProjection = new Matrix4()
const _eye = new Vector3()
const _forward = new Vector3()
const _box = new Box3()

/**
 * Shadow of the sun light fitted to the terrain seen by the view camera (see the module comment). The renderer
 * calls `updateMatrices(light, viewCamera)` right before drawing the shadow map, once cameras, lights and
 * terrain visibility are final for the frame.
 */
export class TerrainShadow extends LightShadow<OrthographicCamera> {
  // what DirectionalLightShadow adds to LightShadow (that class is not exported by three)
  readonly isDirectionalLightShadow = true
  /** group of the terrain tile meshes (the engine's) */
  terrain: Object3D

  constructor(terrain: Object3D, mapSize: number) {
    super(new OrthographicCamera())
    this.terrain = terrain
    this.mapSize.set(mapSize, mapSize)
    this.radius = SHADOW_RADIUS
  }

  override updateMatrices(light: Light, viewCamera?: Camera): void {
    super.updateMatrices(light) // places the shadow camera on the light, looking at its target
    const fit = viewCamera ? this.fit(viewCamera) : null
    if (!fit) return
    const camera = this.camera
    camera.left = fit.left
    camera.right = fit.right
    camera.bottom = fit.bottom
    camera.top = fit.top
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    this.normalBias = NORMAL_BIAS_TEXELS * fit.texelSize
    this.bias = -DEPTH_BIAS_M / (fit.far - fit.near)
    super.updateMatrices(light) // shadow matrix and culling frustum with the new projection
  }

  private fit(view: Camera): ShadowFit | null {
    _box.makeEmpty()
    const meshes = this.terrain.children
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i] as Mesh
      const bounds = mesh.visible ? mesh.geometry?.boundingBox : null
      if (bounds) _box.union(bounds) // tile meshes sit at the origin of an identity group
    }
    if (_box.isEmpty()) return null
    _viewProjection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_viewProjection, view.coordinateSystem)
    view.getWorldPosition(_eye)
    view.getWorldDirection(_forward)
    const distance = shadowDistance(_eye.y, _box.min.y)
    return fitShadowFrustum(_frustum, _eye, _forward, distance, _box, this.camera.matrixWorldInverse, this.mapSize.x)
  }
}
