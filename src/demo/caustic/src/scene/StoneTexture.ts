import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tileableNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable limestone-like grain. Red channel carries the brightness variation (mean ~0.5). */
export function createStoneTexture(size = 512): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      let amplitude = 0.5;
      let total = 0;
      for (let octave = 0; octave < 6; octave++) {
        const period = 4 << octave;
        value += amplitude * tileableNoise((x / size) * period, (y / size) * period, period, octave * 17 + 3);
        total += amplitude;
        amplitude *= 0.55;
      }
      value /= total;
      // Fine pitting on top of the broad mottling.
      const pit = hash(x, y, 91) * 0.12;
      const shade = Math.min(1, Math.max(0, value * 0.9 + pit));
      const byte = Math.round(shade * 255);
      const o = (y * size + x) * 4;
      data[o] = byte;
      data[o + 1] = byte;
      data[o + 2] = byte;
      data[o + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
