import * as THREE from "../../vendor/three/build/three.webgpu.js";

// Thin overlapping scales, with a curved free edge facing the tail (-U).
// Color, fin rays, film thickness and roughness share one small mipmapped tile.
// Full-precision relief is baked separately into the normal map.
export function createFishTexture() {
  const size = 256,
    data = new Uint8Array(size * size * 4),
    heights = new Float32Array(size * size);
  const smoothstep = THREE.MathUtils.smoothstep;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 4,
        v = (y / size) * 4;
      let height = 0,
        lip = 0,
        variation = 0;
      for (let row = Math.floor(v) - 1; row <= Math.floor(v) + 1; row++) {
        const offset = ((row + 4) % 2) * 0.5;
        for (
          let column = Math.floor(u - offset) - 1;
          column <= Math.floor(u - offset) + 1;
          column++
        ) {
          const dx = u - (column + 0.5 + offset),
            dy = v - (row + 0.5);
          const edge = dx - (-0.37 + 0.85 * dy * dy);
          const width = 1 - smoothstep(Math.abs(dy), 0.38, 0.58);
          const rise = smoothstep(edge, -0.025, 0.045);
          const plate = rise * (1 - smoothstep(edge, 0.04, 0.92)) * width;
          const rim = Math.exp(-(((edge - 0.04) / 0.055) ** 2)) * width;
          const relief = plate * 0.13 + rim * 0.018;
          if (relief > height) {
            height = relief;
            lip = rim;
            // Four-cell periodicity keeps both texture seams continuous.
            variation = Math.sin(
              ((column + 8) % 4) * 2.17 + ((row + 4) % 4) * 1.41,
            );
          }
        }
      }
      const i = (y * size + x) * 4;
      heights[y * size + x] = height;
      data[i] = Math.round(255 * (0.97 - lip * 0.035 + variation * 0.018));
      // Fins reuse this sampler with radial UVs. Their fine rays occupy the
      // otherwise unused green channel and get free mipmap filtering.
      const ray =
        1 - smoothstep(Math.abs((((x / size) * 14) % 1) - 0.5), 0.045, 0.115);
      data[i + 1] = Math.round(255 * (1 - ray * 0.18));
      data[i + 2] = Math.round(255 * (0.47 + lip * 0.09 + variation * 0.045));
      data[i + 3] = Math.round(255 * (0.28 + lip * 0.28 + variation * 0.045));
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  // Bake tangent-space slopes from the same relief. A dedicated normal map
  // gives lighting and SSR the scale facets directly, independent of the
  // height sampler's screen-space differencing and its shared color sample.
  const normalData = new Uint8Array(size * size * 4);
  // Differentiate full-precision heights before quantizing the normals. This
  // avoids terraces in shallow relief from an 8-bit intermediate height map.
  const height = (x, y) =>
    heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * size * 0.075;
      const dy = (height(x, y + 1) - height(x, y - 1)) * size * 0.075;
      const length = Math.hypot(dx, dy, 1),
        i = (y * size + x) * 4;
      normalData[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normalData[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normalData[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      normalData[i + 3] = 255;
    }
  const normalTexture = new THREE.DataTexture(normalData, size, size);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.magFilter = THREE.LinearFilter;
  normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
  normalTexture.generateMipmaps = true;
  normalTexture.needsUpdate = true;
  return { texture, normalTexture };
}
