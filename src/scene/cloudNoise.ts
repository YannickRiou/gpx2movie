/** Noise texture of the volumetric clouds and of the aerial perspective (see CloudsLayer). */
import { Data3DTexture, NearestFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three'

const NOISE_SIZE = 128
const NOISE_DEPTH = 64

/**
 * Stand-in for the spatiotemporal blue noise of the cloud and aerial perspective shaders: interleaved gradient
 * noise, one slice per frame index (shifted by 5.588238 px per slice). Generated once (1 MB), deterministic.
 */
export function createCloudNoiseTexture(): Data3DTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_DEPTH)
  let i = 0
  for (let z = 0; z < NOISE_DEPTH; z++) {
    const shift = 5.588238 * z
    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        const g = 0.06711056 * (x + shift) + 0.00583715 * (y + shift)
        const v = 52.9829189 * (g - Math.floor(g))
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
