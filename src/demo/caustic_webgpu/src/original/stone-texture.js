import {
  DataTexture,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
} from "../../vendor/three/build/three.webgpu.js";

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => x * x * (3 - 2 * x);
function hash(x, y, seed) {
  let n =
    Math.imul(x + seed * 17, 374761393) ^ Math.imul(y + seed * 31, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(u, v, cells, seed) {
  const x = u * cells,
    y = v * cells,
    ix = Math.floor(x),
    iy = Math.floor(y),
    fx = smooth(x - ix),
    fy = smooth(y - iy);
  const a = hash(ix % cells, iy % cells, seed),
    b = hash((ix + 1) % cells, iy % cells, seed);
  const c = hash(ix % cells, (iy + 1) % cells, seed),
    d = hash((ix + 1) % cells, (iy + 1) % cells, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fractalWear(u, v) {
  let value = 0,
    weight = 0,
    amplitude = 1,
    cells = 6;
  for (let octave = 0; octave < 6; octave++) {
    value += noise(u, v, cells, 53 + octave * 19) * amplitude;
    weight += amplitude;
    amplitude *= 0.6;
    cells *= 2;
  }
  return value / weight;
}

// Seamless packed data: mottling in R, wear in G, aggregate height in B,
// and six-octave fractal wear in A for the smooth floor's roughness.
export function createConcreteTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const cloud =
        noise(u, v, 4, 11) * 0.55 +
        noise(u, v, 9, 13) * 0.3 +
        noise(u, v, 21, 17) * 0.15;
      const wear = noise(u, v, 6, 23) * 0.65 + noise(u, v, 17, 29) * 0.35;
      const aggregate = noise(u, v, 55, 31),
        fine = noise(u, v, 143, 37);
      const pores = smooth(clamp((noise(u, v, 353, 41) - 0.58) / 0.3));
      const i = (y * size + x) * 4;
      data[i] = Math.round(
        clamp(
          0.56 + (cloud - 0.5) * 0.7 + (aggregate - 0.5) * 0.22 - pores * 0.3,
        ) * 255,
      );
      data[i + 1] = Math.round(clamp(0.5 + (wear - 0.5) * 2) * 255);
      data[i + 2] = Math.round(
        clamp(
          0.5 + (aggregate - 0.5) * 0.42 + (fine - 0.5) * 0.2 - pores * 0.22,
        ) * 255,
      );
      data[i + 3] = Math.round(fractalWear(u, v) * 255);
    }
  const map = new DataTexture(data, size, size);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}
