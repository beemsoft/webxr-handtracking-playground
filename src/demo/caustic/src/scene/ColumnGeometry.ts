import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';

const FLUTES = 16;
const SEGMENTS_PER_FLUTE = 5;
const SEGMENTS = FLUTES * SEGMENTS_PER_FLUTE;
/** Flute depth relative to the shaft radius. */
const FLUTE_DEPTH = 0.1;
/** The flutes run out into the smooth ring above the base and below the capital (metres). */
const FLUTE_RUNOUT = 0.32;

/** Base moulding (plinth, torus, scotia, torus) as [radius factor, y]; the original demo's profile. */
const BASE: Array<[number, number]> = [
  [1.25, 0],
  [1.31, 0.025],
  [1.32, 0.055],
  [1.3, 0.085],
  [1.24, 0.11],
  [1.08, 0.14],
  [1.08, 0.16],
  [1.15, 0.185],
  [1.16, 0.215],
  [1.11, 0.245],
  [1.03, 0.27],
];

/** Capital mouldings (necking, astragal, echinus, abacus) as [radius factor, offset below the top]. */
const CAPITAL: Array<[number, number]> = [
  [0.92, 0.34],
  [1, 0.315],
  [1.02, 0.29],
  [1.01, 0.265],
  [0.98, 0.24],
  [1.04, 0.205],
  [1.17, 0.15],
  [1.28, 0.11],
  [1.32, 0.075],
  [1.32, 0.035],
  [1.28, 0],
];

interface Ring {
  radius: number;
  y: number;
  /** 0 = round, 1 = fully fluted. */
  flute: number;
}

/**
 * A Roman column turned on a lathe, like the original's, with a moulded base, a shaft that swells
 * gently (entasis) and a layered capital. Unlike a plain lathe the shaft is fluted: sixteen shallow
 * grooves with sharp arrises that run out into the smooth rings at either end. The geometry is
 * indexed, has no seam vertices (smooth normals all the way round) and carries `uv` so it merges with
 * the other limestone parts. The base sits on y = 0 and the open top ends at `height`.
 */
export function createColumnGeometry(radius: number, height: number): BufferGeometry {
  const rings: Ring[] = [];
  for (const [r, y] of BASE) rings.push({ radius: r, y, flute: 0 });

  const shaftStart = 0.3;
  const shaftLength = height - 0.68;
  const ends = [0, 0.04, 0.1, 0.2, 0.35];
  const offsets: number[] = [...ends];
  const middle = 6;
  for (let i = 1; i < middle; i++) {
    offsets.push(ends[ends.length - 1] + ((shaftLength - 2 * ends[ends.length - 1]) * i) / middle);
  }
  for (let i = ends.length - 1; i >= 0; i--) offsets.push(shaftLength - ends[i]);
  for (const s of offsets) {
    const t = s / shaftLength;
    // Gentle entasis keeps the long shaft from reading as a straight pipe.
    const r = 1 - 0.08 * t + 0.035 * Math.sin(Math.PI * t);
    const flute = MathUtils.smoothstep(Math.min(s, shaftLength - s), 0, FLUTE_RUNOUT);
    rings.push({ radius: r, y: shaftStart + s, flute });
  }

  for (const [r, below] of CAPITAL) rings.push({ radius: r, y: height - below, flute: 0 });

  const count = rings.length * SEGMENTS;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    for (let j = 0; j < SEGMENTS; j++) {
      const theta = (j / SEGMENTS) * Math.PI * 2;
      // Sharp arris between flutes, round-bottomed groove in the middle.
      const u = Math.abs(Math.sin((FLUTES * theta) / 2));
      const groove = Math.sin((u * Math.PI) / 2);
      const r = ring.radius * radius * (1 - FLUTE_DEPTH * ring.flute * groove);
      const k = i * SEGMENTS + j;
      positions[k * 3] = r * Math.sin(theta);
      positions[k * 3 + 1] = ring.y;
      positions[k * 3 + 2] = r * Math.cos(theta);
      uvs[k * 2] = j / SEGMENTS;
      uvs[k * 2 + 1] = ring.y / height;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * SEGMENTS + j;
      const c = i * SEGMENTS + ((j + 1) % SEGMENTS);
      const b = (i + 1) * SEGMENTS + j;
      const d = (i + 1) * SEGMENTS + ((j + 1) % SEGMENTS);
      indices.push(a, c, b, c, d, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
