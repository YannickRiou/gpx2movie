/** Noise texture of the volumetric clouds and of the aerial perspective (see CloudsLayer). */
import { Data3DTexture, NearestFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three'

const NOISE_SIZE = 128
const NOISE_DEPTH = 64

/** Fractional part of the golden ratio: the additive recurrence with the lowest discrepancy. */
const GOLDEN = 0.6180339887498949

/**
 * Stand-in for the spatiotemporal blue noise of the cloud and aerial perspective shaders, one slice per frame index:
 * interleaved gradient noise in space, shifted by the golden ratio from one slice to the next. The values a pixel
 * takes over any run of consecutive slices are then evenly spread over [0, 1) (stratified), so an average of frames
 * (still preview, exported frame) converges faster than with the former shift of 5.588238 px per slice (32 frames:
 * residual noise −27 %, measured with SwiftShader). Generated once (1 MB), deterministic.
 */
export function createCloudNoiseTexture(): Data3DTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_DEPTH)
  let i = 0
  for (let z = 0; z < NOISE_DEPTH; z++) {
    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        const g = 0.06711056 * x + 0.00583715 * y
        const v = 52.9829189 * (g - Math.floor(g)) + GOLDEN * z
        data[i++] = Math.floor((v - Math.floor(v)) * 256)
      }
    }
  }
  const texture = new Data3DTexture(data, NOISE_SIZE, NOISE_SIZE, NOISE_DEPTH)
  texture.type = UnsignedByteType
  texture.format = RedFormat
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping
  texture.needsUpdate = true
  return texture
}
