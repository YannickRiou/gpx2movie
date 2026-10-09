import { describe, expect, it } from 'vitest'
import { BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Sphere, Vector3 } from 'three'
import type { TileKey } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { boundsIntersect, tileBounds, tileCenter, tileGroundSizeM, tilesForBounds } from '../geo/mercator'
import {
  TileNode,
  computeConservativeSphere,
  createCameraState,
  createRootNodes,
  createSelectionResult,
  forEachNode,
  isLoadable,
  screenSpaceError,
  selectTiles,
  updateCameraState,
  zoomLimit,
  type CameraState,
  type QuadtreeContext,
} from './quadtree'

/** z=10 tile over the Mont Blanc massif (~27 km wide). */
const ROOT_KEY: TileKey = { z: 10, x: 531, y: 364 }
const CENTER = tileCenter(ROOT_KEY)
const FRAME = createLocalFrame(CENTER.lon, CENTER.lat)
const CTX: QuadtreeContext = { frame: FRAME, segments: 64 }

function cameraLookingAt(position: Vector3, target: Vector3, fov = 50, viewportH = 1000): CameraState {
  const camera = new PerspectiveCamera(fov, 1, 1, 5e6)
  camera.position.copy(position)
  // when looking straight down, "up" must not be parallel to the view direction
  camera.up.set(0, 0, -1)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  const state = createCameraState()
  updateCameraState(state, camera, viewportH)
  return state
}

function makeReady(node: TileNode): void {
  node.state = 'ready'
  node.mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial())
}

describe('screenSpaceError', () => {
  it('matches geometricError * viewportH / (2 * dist * tan(fov/2))', () => {
    const cam = createCameraState()
    cam.position.set(0, 100, 0)
    cam.tanHalfFov = 1
    cam.viewportHeightPx = 1000
    const sphere = new Sphere(new Vector3(0, 0, 0), 0)
    expect(screenSpaceError(10, sphere, cam)).toBeCloseTo(50, 9)
    sphere.radius = 20
    expect(screenSpaceError(10, sphere, cam)).toBeCloseTo(62.5, 9)
  })

  it('clamps the distance to 1 m when the camera is inside the sphere', () => {
    const cam = createCameraState()
    cam.position.set(0, 10, 0)
    cam.tanHalfFov = 0.5
    cam.viewportHeightPx = 800
    const sphere = new Sphere(new Vector3(0, 0, 0), 500)
    expect(screenSpaceError(2, sphere, cam)).toBeCloseTo((2 * 800) / (2 * 1 * 0.5), 9)
  })
})

describe('computeConservativeSphere', () => {
  it('contains the tile corners and centre at both extreme heights', () => {
    const bounds = tileBounds(ROOT_KEY)
    const sphere = computeConservativeSphere(bounds, FRAME)
    const probe = new Vector3()
    const points: Array<[number, number]> = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [(bounds.west + bounds.east) / 2, (bounds.north + bounds.south) / 2],
      [bounds.west + (bounds.east - bounds.west) * 0.25, bounds.north + (bounds.south - bounds.north) * 0.8],
    ]
    for (const [lon, lat] of points) {
      for (const h of [-500, 0, 4000, 9000]) {
        FRAME.toLocal(lon, lat, h, probe)
        expect(sphere.containsPoint(probe)).toBe(true)
      }
    }
    // and it is not absurdly large: about the tile diagonal
    expect(sphere.radius).toBeLessThan(tileGroundSizeM(ROOT_KEY) * 1.2)
  })
})

describe('TileNode', () => {
  it('derives bounds, geometric error and a conservative sphere from the key', () => {
    const node = new TileNode(ROOT_KEY, undefined, CTX)
    expect(node.id).toBe('10/531/364')
    expect(node.bounds).toEqual(tileBounds(ROOT_KEY))
    expect(node.geometricError).toBeCloseTo(tileGroundSizeM(ROOT_KEY) / 64, 9)
    expect(node.state).toBe('empty')
    expect(node.boundingSphere.radius).toBeGreaterThan(0)
    expect(node.children).toBeUndefined()
  })

  it('creates four children once, linked to their parent, and halves the geometric error', () => {
    const node = new TileNode(ROOT_KEY, undefined, CTX)
    const children = node.ensureChildren()
    expect(children).toHaveLength(4)
    expect(node.ensureChildren()).toBe(children)
    for (const child of children) {
      expect(child.parent).toBe(node)
      expect(child.key.z).toBe(11)
      expect(node.isAncestorOf(child)).toBe(true)
      expect(child.isAncestorOf(node)).toBe(false)
      expect(child.geometricError).toBeCloseTo(node.geometricError / 2, -1)
    }
  })

  it('tightens the sphere to loaded geometry and restores the conservative one', () => {
    const node = new TileNode(ROOT_KEY, undefined, CTX)
    const conservativeRadius = node.boundingSphere.radius
    const geometry = new BufferGeometry()
    geometry.boundingSphere = new Sphere(new Vector3(1, 2, 3), 10)
    node.setGeometryBounds(geometry)
    expect(node.boundingSphere.radius).toBe(10)
    expect(node.boundingSphere.center.x).toBe(1)
    node.resetBounds()
    expect(node.boundingSphere.radius).toBeCloseTo(conservativeRadius, 6)
  })
})

describe('isLoadable', () => {
  it('allows empty nodes and failed nodes once their retry frame has passed', () => {
    const node = new TileNode(ROOT_KEY, undefined, CTX)
    expect(isLoadable(node, 0)).toBe(true)
    node.state = 'loading'
    expect(isLoadable(node, 0)).toBe(false)
    node.state = 'ready'
    expect(isLoadable(node, 0)).toBe(false)
    node.state = 'failed'
    node.failedAttempts = 1
    node.retryAtFrame = 100
    expect(isLoadable(node, 50)).toBe(false)
    expect(isLoadable(node, 100)).toBe(true)
    node.failedAttempts = 3
    expect(isLoadable(node, 100)).toBe(false)
    expect(isLoadable(node, 100, 5)).toBe(true)
  })
})

describe('selectTiles', () => {
  const farAbove = () => cameraLookingAt(new Vector3(0, 200_000, 0), new Vector3(0, 0, 0))

  it('queues an unloaded root (nothing to render) and stamps the visit frame', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    const out = selectTiles([root], farAbove(), { errorTargetPx: 3, maxZoom: 15, frame: 7 })
    expect(out.toRender).toEqual([])
    expect(out.toLoad).toEqual([root])
    expect(root.lastVisitedFrame).toBe(7)
    expect(root.sse).toBeGreaterThan(0)
    expect(root.priority).toBe(root.sse)
  })

  it('renders a ready root when its screen-space error is under the target', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const cam = farAbove()
    const out = selectTiles([root], cam, { errorTargetPx: 1e9, maxZoom: 15, frame: 1 })
    expect(out.toRender).toEqual([root])
    expect(out.toLoad).toEqual([])
    expect(root.children).toBeUndefined()
  })

  it('keeps rendering the parent and queues the children (by sse) while they are not ready', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const out = selectTiles([root], farAbove(), { errorTargetPx: 0.001, maxZoom: 11, frame: 1 })
    expect(out.toRender).toEqual([root])
    expect(root.children).toBeDefined()
    expect(out.toLoad).toHaveLength(4)
    for (const child of out.toLoad) {
      expect(child.parent).toBe(root)
      expect(child.priority).toBeGreaterThan(0)
      expect(child.lastVisitedFrame).toBe(1)
    }
    for (let i = 1; i < out.toLoad.length; i++) {
      expect(out.toLoad[i - 1].priority).toBeGreaterThanOrEqual(out.toLoad[i].priority)
    }
  })

  it('still renders the parent when only three of four visible children are ready', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const children = root.ensureChildren()
    makeReady(children[0])
    makeReady(children[1])
    makeReady(children[2])
    const out = selectTiles([root], farAbove(), { errorTargetPx: 0.001, maxZoom: 11, frame: 2 })
    expect(out.toRender).toEqual([root])
    expect(out.toLoad).toEqual([children[3]])
  })

  it('replaces the parent by its four children once they are all ready', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const children = root.ensureChildren()
    for (const child of children) makeReady(child)
    const out = selectTiles([root], farAbove(), { errorTargetPx: 0.001, maxZoom: 11, frame: 3 })
    expect(out.toRender).toHaveLength(4)
    expect(out.toRender).not.toContain(root)
    for (const child of children) expect(out.toRender).toContain(child)
    expect(out.toLoad).toEqual([])
    // maxZoom = 11 stops the refinement: no grandchildren were created
    for (const child of children) expect(child.children).toBeUndefined()
  })

  it('treats children outside the frustum as ready for replacement but queues them at low priority', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const children = root.ensureChildren()
    const nw = children[0]
    makeReady(nw)
    // Camera 3 km above the centre of the NW child, looking straight down with a narrow fov:
    // the other three children are out of the frustum.
    const nwCenter = tileCenter(nw.key)
    const eye = FRAME.toLocal(nwCenter.lon, nwCenter.lat, 3000)
    const target = FRAME.toLocal(nwCenter.lon, nwCenter.lat, 0)
    const cam = cameraLookingAt(eye, target, 30)
    expect(cam.frustum.intersectsSphere(nw.boundingSphere)).toBe(true)
    expect(cam.frustum.intersectsSphere(children[3].boundingSphere)).toBe(false)

    const out = selectTiles([root], cam, { errorTargetPx: 3, maxZoom: 11, frame: 4 })
    expect(out.toRender).toEqual([nw])
    expect(out.toLoad).toHaveLength(3)
    for (const node of out.toLoad) {
      expect(node).not.toBe(nw)
      expect(node.priority).toBeLessThan(0)
      expect(node.sse).toBe(0)
      expect(node.lastVisitedFrame).toBe(4)
    }
  })

  it('falls back to the parent when a visible child is not ready even if others are', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const children = root.ensureChildren()
    makeReady(children[1])
    makeReady(children[2])
    makeReady(children[3])
    const nwCenter = tileCenter(children[0].key)
    const cam = cameraLookingAt(FRAME.toLocal(nwCenter.lon, nwCenter.lat, 3000), FRAME.toLocal(nwCenter.lon, nwCenter.lat, 0), 30)
    const out = selectTiles([root], cam, { errorTargetPx: 3, maxZoom: 11, frame: 5 })
    expect(out.toRender).toEqual([root])
    expect(out.toLoad[0]).toBe(children[0])
    expect(out.toLoad[0].priority).toBeGreaterThan(0)
  })

  it('draws the ready descendants of a node that should be drawn but is not ready (no hole)', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    const children = root.ensureChildren()
    for (const child of children) makeReady(child)
    // The root failed for good (404 and attempts exhausted) while its children were loaded earlier.
    root.state = 'failed'
    root.failedAttempts = 3
    const out = selectTiles([root], farAbove(), { errorTargetPx: 1e9, maxZoom: 15, frame: 9 })
    expect(out.toRender).toHaveLength(4)
    for (const child of children) {
      expect(out.toRender).toContain(child)
      expect(child.lastVisitedFrame).toBe(9) // kept alive by the sweep while they stand in
    }
    expect(out.toLoad).toEqual([])

    // The fallback recurses: a child that is not ready itself hands over to its ready children.
    children[0].state = 'empty'
    children[0].mesh = undefined
    const grandchildren = children[0].ensureChildren()
    makeReady(grandchildren[1])
    const again = selectTiles([root], farAbove(), { errorTargetPx: 1e9, maxZoom: 15, frame: 10 })
    expect(again.toRender).toHaveLength(4)
    expect(again.toRender).toContain(grandchildren[1])
    expect(again.toRender).not.toContain(children[0])
    expect(grandchildren[1].lastVisitedFrame).toBe(10)
  })

  it('does not retry a failed child before its retry frame and never beyond the attempt budget', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const children = root.ensureChildren()
    for (const child of children) makeReady(child)
    const failing = children[2]
    failing.state = 'failed'
    failing.mesh = undefined
    failing.failedAttempts = 1
    failing.retryAtFrame = 50
    const params = { errorTargetPx: 0.001, maxZoom: 11, frame: 10 }
    const early = selectTiles([root], farAbove(), params)
    expect(early.toRender).toEqual([root])
    expect(early.toLoad).toEqual([])
    const late = selectTiles([root], farAbove(), { ...params, frame: 50 })
    expect(late.toLoad).toEqual([failing])
    failing.failedAttempts = 3
    const exhausted = selectTiles([root], farAbove(), { ...params, frame: 500 })
    expect(exhausted.toLoad).toEqual([])
    expect(exhausted.toRender).toEqual([root])
  })

  it('outside the detail area, stops at the outer zoom; inside or without one, at maxZoom', () => {
    const inside = tileBounds(ROOT_KEY)
    const elsewhere = { west: 0, south: 40, east: 0.1, north: 40.1 }
    const node = new TileNode(ROOT_KEY, undefined, CTX)
    const params = { errorTargetPx: 3, maxZoom: 15, frame: 1, outerMaxZoom: 10 }
    expect(zoomLimit(node, params)).toBe(15)
    expect(zoomLimit(node, { ...params, detailArea: inside })).toBe(15)
    expect(zoomLimit(node, { ...params, detailArea: elsewhere })).toBe(10)
    expect(zoomLimit(node, { ...params, detailArea: elsewhere, maxZoom: 9 })).toBe(9)

    // a z10 root far from the detail area is never split, however fine the target
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    makeReady(root)
    const out = selectTiles([root], farAbove(), { ...params, errorTargetPx: 0.001, detailArea: elsewhere })
    expect(out.toRender).toEqual([root])
    expect(root.children).toBeUndefined()
  })

  it('reuses the output arrays it is given', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    const out = createSelectionResult()
    const first = selectTiles([root], farAbove(), { errorTargetPx: 3, maxZoom: 15, frame: 1 }, out)
    expect(first).toBe(out)
    makeReady(root)
    const second = selectTiles([root], farAbove(), { errorTargetPx: 1e9, maxZoom: 15, frame: 2 }, out)
    expect(second.toRender).toEqual([root])
    expect(second.toLoad).toEqual([])
  })
})

describe('createRootNodes / forEachNode', () => {
  const area = { west: 6.6, south: 45.7, east: 7.2, north: 46.1 }

  it('covers the area with at most the tile budget, never below minZoom', () => {
    const roots = createRootNodes(area, 0, 15, CTX)
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.length).toBeLessThanOrEqual(16)
    const z = roots[0].key.z
    expect(roots.every((r) => r.key.z === z)).toBe(true)
    expect(roots.every((r) => boundsIntersect(r.bounds, area))).toBe(true)
    expect(roots.map((r) => r.id)).toEqual(tilesForBounds(area, z).map((k) => `${k.z}/${k.x}/${k.y}`))
    const clamped = createRootNodes(area, 12, 15, CTX)
    expect(clamped.every((r) => r.key.z >= 12)).toBe(true)
  })

  it('walks the tree in pre- or post-order', () => {
    const root = new TileNode(ROOT_KEY, undefined, CTX)
    root.ensureChildren()
    const pre: string[] = []
    forEachNode([root], (n) => pre.push(n.id))
    expect(pre[0]).toBe(root.id)
    expect(pre).toHaveLength(5)
    const post: string[] = []
    forEachNode([root], (n) => post.push(n.id), true)
    expect(post[4]).toBe(root.id)
  })
})
