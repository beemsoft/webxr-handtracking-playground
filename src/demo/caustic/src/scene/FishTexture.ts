import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MathUtils, RepeatWrapping } from 'three';

const { smoothstep } = MathUtils;

function configure(texture: DataTexture): DataTexture {
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Thin overlapping scales with a curved free edge facing the tail (-U), after the original demo.
 * Channels of the colour tile: r scale albedo, g fin rays, b film thickness, a gloss. A second tile
 * holds the tangent-space relief baked from the same height field.
 */
export function createFishTextures(size = 256): { map: DataTexture; normalMap: DataTexture } {
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 4;
      const v = (y / size) * 4;
      let height = 0;
      let lip = 0;
      let variation = 0;
      for (let row = Math.floor(v) - 1; row <= Math.floor(v) + 1; row++) {
        const offset = ((row + 4) % 2) * 0.5;
        for (let column = Math.floor(u - offset) - 1; column <= Math.floor(u - offset) + 1; column++) {
          const dx = u - (column + 0.5 + offset);
          const dy = v - (row + 0.5);
          const edge = dx - (-0.37 + 0.85 * dy * dy);
          const width = 1 - smoothstep(Math.abs(dy), 0.38, 0.58);
          const rise = smoothstep(edge, -0.025, 0.045);
          const plate = rise * (1 - smoothstep(edge, 0.04, 0.92)) * width;
          const rim = Math.exp(-(((edge - 0.04) / 0.055) ** 2)) * width;
          const relief = plate * 0.13 + rim * 0.018;
          if (relief > height) {
            height = relief;
            lip = rim;
            variation = Math.sin(((column + 8) % 4) * 2.17 + ((row + 4) % 4) * 1.41);
          }
        }
      }
      const i = (y * size + x) * 4;
      heights[y * size + x] = height;
      data[i] = Math.round(255 * (0.97 - lip * 0.035 + variation * 0.018));
      const ray = 1 - smoothstep(Math.abs((((x / size) * 14) % 1) - 0.5), 0.045, 0.115);
      data[i + 1] = Math.round(255 * (1 - ray * 0.18));
      data[i + 2] = Math.round(255 * (0.47 + lip * 0.09 + variation * 0.045));
      data[i + 3] = Math.round(255 * (0.28 + lip * 0.28 + variation * 0.045));
    }
  }

  const heightAt = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  const normalData = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * size * 0.075;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * size * 0.075;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normalData[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normalData[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normalData[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      normalData[i + 3] = 255;
    }
  }

  return {
    map: configure(new DataTexture(data, size, size)),
    normalMap: configure(new DataTexture(normalData, size, size)),
  };
}
