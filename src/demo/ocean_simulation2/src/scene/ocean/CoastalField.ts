import * as THREE from 'three';
import { CoastalFieldResult } from './OceanTypes';
export type { CoastalFieldResult };

export function buildCoastalFieldSync(
  heightData: Uint16Array,
  heightResolution: number,
  extent: number,
  compact: boolean,
  floatLinear = true
): CoastalFieldResult {
  const n = compact ? 128 : 192;
  const dx = extent / n;
  const direction: [number, number] = [Math.cos(0.48), Math.sin(0.48)];
  const k0 = (2 * Math.PI) / 78;
  const omega2 = 9.81 * k0;
  const c0 = Math.sqrt(9.81 / k0);
  const bed = new Float32Array(n * n);
  const slow = new Float32Array(n * n);
  const travel = new Float64Array(n * n).fill(1e8);
  const fixed = new Uint8Array(n * n);

  const readBed = (x: number, z: number): number => {
    const ix = Math.max(0, Math.min(heightResolution - 1, Math.floor((x / extent + 0.5) * heightResolution)));
    const iz = Math.max(0, Math.min(heightResolution - 1, Math.floor((z / extent + 0.5) * heightResolution)));
    return THREE.DataUtils.fromHalfFloat(heightData[(iz * heightResolution + ix) * 4]);
  };

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x + 0.5) * dx - extent * 0.5;
      const wz = (z + 0.5) * dx - extent * 0.5;
      bed[i] = readBed(wx, wz);
      const h = Math.max(0.38, -bed[i]);
      let k = Math.max(k0, Math.sqrt(omega2 / (9.81 * h)));
      for (let j = 0; j < 5; j++) {
        const t = Math.tanh(k * h);
        k = Math.max(k0, k - (9.81 * k * t - omega2) / (9.81 * (t + k * h * (1 - t * t))));
      }
      slow[i] = k / Math.sqrt(omega2);
      // Waves cannot travel through land or through emerged rock tops.
      if (bed[i] > 1.8) continue;
      if (x === 0 || z === 0) {
        travel[i] = ((wx + extent) * direction[0] + (wz + extent) * direction[1]) / c0;
        fixed[i] = 1;
      }
    }
  }

  // Monotone Godunov fast sweeps solve |grad T| = 1 / c(h)
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      for (let zz = 0; zz < n; zz++) {
        for (let xx = 0; xx < n; xx++) {
          const x = sx > 0 ? xx : n - xx - 1;
          const z = sz > 0 ? zz : n - zz - 1;
          const i = z * n + x;
          if (fixed[i] || bed[i] > 1.8) continue;
          const a = Math.min(x ? travel[i - 1] : 1e8, x + 1 < n ? travel[i + 1] : 1e8);
          const b = Math.min(z ? travel[i - n] : 1e8, z + 1 < n ? travel[i + n] : 1e8);
          const step = slow[i] * dx;
          const diff = Math.abs(a - b);
          const value =
            diff >= step
              ? Math.min(a, b) + step
              : (a + b + Math.sqrt(Math.max(0, 2 * step * step - diff * diff))) * 0.5;
          travel[i] = Math.min(travel[i], value);
        }
      }
    }
  }

  const data = new Float32Array(n * n * 4);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x + 0.5) * dx - extent * 0.5;
      const wz = (z + 0.5) * dx - extent * 0.5;
      const reference = (wx + extent) * direction[0] + (wz + extent) * direction[1];
      if (travel[i] > 1e7) {
        data.set([0, direction[0], direction[1], 0.04], i * 4);
        continue;
      }
      const validTime = (j: number) => (travel[j] > 1e7 ? travel[i] : travel[j]);
      const gx = validTime(z * n + Math.min(n - 1, x + 1)) - validTime(z * n + Math.max(0, x - 1));
      const gz = validTime(Math.min(n - 1, z + 1) * n + x) - validTime(Math.max(0, z - 1) * n + x);
      const length = Math.hypot(gx, gz) || 1;
      let exposure = 0;

      // Directional fetch integrates a fan of incident swell rays.
      for (let ray = -3; ray <= 3; ray++) {
        const angle = 0.48 + ray * 0.14;
        const rx = Math.cos(angle);
        const rz = Math.sin(angle);
        let energy = 1;
        for (let step = 1; step <= 28; step++) {
          const distance = step * 12;
          const h = readBed(wx - rx * distance, wz - rz * distance);
          if (h > 0.8) {
            energy = 0.025;
            break;
          }
          if (h > -0.5) energy *= 0.87;
        }
        exposure += energy / 7;
      }

      exposure = 0.09 + 0.91 * exposure;
      data.set(
        [
          Math.max(-10, Math.min(800, travel[i] * c0 - reference)),
          gx / length,
          gz / length,
          exposure,
        ],
        i * 4
      );
    }
  }

  const pixels = floatLinear
    ? data
    : Uint16Array.from(data, (value) => THREE.DataUtils.toHalfFloat(value));
  const texture = new THREE.DataTexture(
    pixels,
    n,
    n,
    THREE.RGBAFormat,
    floatLinear ? THREE.FloatType : THREE.HalfFloatType
  );
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return { texture, data, resolution: n, direction, c0 };
}

export async function buildCoastalField(
  heightData: Uint16Array,
  heightResolution: number,
  extent: number,
  compact: boolean,
  floatLinear = true
): Promise<CoastalFieldResult> {
  const n = compact ? 256 : 384;
  const dx = extent / n;
  const direction: [number, number] = [Math.cos(0.48), Math.sin(0.48)];
  const k0 = (2 * Math.PI) / 78;
  const omega2 = 9.81 * k0;
  const c0 = Math.sqrt(9.81 / k0);
  const bed = new Float32Array(n * n);
  const slow = new Float32Array(n * n);
  const travel = new Float64Array(n * n).fill(1e8);
  const fixed = new Uint8Array(n * n);

  const readBed = (x: number, z: number): number => {
    const ix = Math.max(0, Math.min(heightResolution - 1, Math.floor((x / extent + 0.5) * heightResolution)));
    const iz = Math.max(0, Math.min(heightResolution - 1, Math.floor((z / extent + 0.5) * heightResolution)));
    return THREE.DataUtils.fromHalfFloat(heightData[(iz * heightResolution + ix) * 4]);
  };

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x + 0.5) * dx - extent * 0.5;
      const wz = (z + 0.5) * dx - extent * 0.5;
      bed[i] = readBed(wx, wz);
      const h = Math.max(0.38, -bed[i]);
      let k = Math.max(k0, Math.sqrt(omega2 / (9.81 * h)));
      for (let j = 0; j < 5; j++) {
        const t = Math.tanh(k * h);
        k = Math.max(k0, k - (9.81 * k * t - omega2) / (9.81 * (t + k * h * (1 - t * t))));
      }
      slow[i] = k / Math.sqrt(omega2);
      // Waves cannot travel through land or through emerged rock tops.
      if (bed[i] > 1.8) continue;
      if (x === 0 || z === 0) {
        travel[i] = ((wx + extent) * direction[0] + (wz + extent) * direction[1]) / c0;
        fixed[i] = 1;
      }
    }
  }

  // Monotone Godunov fast sweeps solve |grad T| = 1 / c(h)
  for (let cycle = 0; cycle < 8; cycle++) {
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      for (let zz = 0; zz < n; zz++) {
        for (let xx = 0; xx < n; xx++) {
          const x = sx > 0 ? xx : n - xx - 1;
          const z = sz > 0 ? zz : n - zz - 1;
          const i = z * n + x;
          if (fixed[i] || bed[i] > 1.8) continue;
          const a = Math.min(x ? travel[i - 1] : 1e8, x + 1 < n ? travel[i + 1] : 1e8);
          const b = Math.min(z ? travel[i - n] : 1e8, z + 1 < n ? travel[i + n] : 1e8);
          const step = slow[i] * dx;
          const diff = Math.abs(a - b);
          const value =
            diff >= step
              ? Math.min(a, b) + step
              : (a + b + Math.sqrt(Math.max(0, 2 * step * step - diff * diff))) * 0.5;
          travel[i] = Math.min(travel[i], value);
        }
      }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const data = new Float32Array(n * n * 4);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x + 0.5) * dx - extent * 0.5;
      const wz = (z + 0.5) * dx - extent * 0.5;
      const reference = (wx + extent) * direction[0] + (wz + extent) * direction[1];
      if (travel[i] > 1e7) {
        data.set([0, direction[0], direction[1], 0.04], i * 4);
        continue;
      }
      const validTime = (j: number) => (travel[j] > 1e7 ? travel[i] : travel[j]);
      const gx = validTime(z * n + Math.min(n - 1, x + 1)) - validTime(z * n + Math.max(0, x - 1));
      const gz = validTime(Math.min(n - 1, z + 1) * n + x) - validTime(Math.max(0, z - 1) * n + x);
      const length = Math.hypot(gx, gz) || 1;
      let exposure = 0;

      // Directional fetch integrates a fan of incident swell rays.
      for (let ray = -3; ray <= 3; ray++) {
        const angle = 0.48 + ray * 0.14;
        const rx = Math.cos(angle);
        const rz = Math.sin(angle);
        let energy = 1;
        for (let step = 1; step <= 28; step++) {
          const distance = step * 12;
          const h = readBed(wx - rx * distance, wz - rz * distance);
          if (h > 0.8) {
            energy = 0.025;
            break;
          }
          if (h > -0.5) energy *= 0.87;
        }
        exposure += energy / 7;
      }

      exposure = 0.09 + 0.91 * exposure;
      data.set(
        [
          Math.max(-10, Math.min(800, travel[i] * c0 - reference)),
          gx / length,
          gz / length,
          exposure,
        ],
        i * 4
      );
    }
  }

  const pixels = floatLinear
    ? data
    : Uint16Array.from(data, (value) => THREE.DataUtils.toHalfFloat(value));
  const texture = new THREE.DataTexture(
    pixels,
    n,
    n,
    THREE.RGBAFormat,
    floatLinear ? THREE.FloatType : THREE.HalfFloatType
  );
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return { texture, data, resolution: n, direction, c0 };
}

export const coastalGLSL = /* glsl */ `
  uniform sampler2D uCoastMap;
  uniform float uSwellGain, uSurfaceWind;
  uniform vec2 uWindDirection;
  vec4 coastField(vec2 p) {
    vec2 uv = p / 550.0 + vec2(0.5);
    vec4 c = texture2D(uCoastMap, clamp(uv, vec2(0.001), vec2(0.999)));
    float edge = 1.0 - smoothstep(0.41, 0.495, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    c = mix(vec4(0.0, 0.886995, 0.461779, 1.0), c, edge);
    c.a = clamp(c.a, 0.0, 1.0);
    c.yz *= inversesqrt(max(dot(c.yz, c.yz), 1e-8));
    return c;
  }
  float energyRegion(vec2 p) {
    return 0.88 + 0.09 * sin(dot(p, vec2(0.0031, 0.0017)) - uTime * 0.012)
      + 0.065 * sin(dot(p, vec2(-0.0013, 0.0041)) + uTime * 0.009);
  }
  vec2 swellCoordinates(vec2 p, vec4 c) { return p + vec2(0.886995, 0.461779) * c.x; }
  vec2 windCoordinates(vec2 p) {
    return vec2(dot(p, uWindDirection), dot(p, vec2(-uWindDirection.y, uWindDirection.x)));
  }
  vec2 turnSwell(vec2 v, vec2 direction) {
    vec2 base = vec2(0.886995, 0.461779);
    return direction * dot(v, base) + vec2(-direction.y, direction.x) * dot(v, vec2(-base.y, base.x));
  }
  vec2 turnWind(vec2 v) { return uWindDirection * v.x + vec2(-uWindDirection.y, uWindDirection.x) * v.y; }
  float coastalDepth(vec2 p) { return max(0.05, -texture2D(uHeightMap, clamp(p / 550.0 + vec2(0.5), vec2(0.001), vec2(0.999))).r); }
  float coastalFoamSupport(float depth) { return 1.0 - smoothstep(22.0, 40.0, depth); }
  float swellEnvelope(float depth, float exposure) {
    float kh = 0.08055 * depth;
    float shoal = clamp(pow(1.0 / max(0.05, tanh(kh)), 0.25) * mix(0.86, 1.0, smoothstep(12.0, 45.0, depth)), 0.86, 1.8);
    float energy = sqrt(exposure);
    float limit = min(1.0, (0.36 * depth + 0.065) / max(0.08, 0.64 * uSwellGain * shoal * energy));
    return shoal * energy * limit;
  }
  float breakerPotential(vec2 p, float crest, float compression) {
    vec4 c = coastField(p);
    float depth = coastalDepth(p);
    float height = 1.5 * uSwellGain * sqrt(c.a);
    float instability = smoothstep(0.48, 0.9, height / max(0.3, depth));
    float amplitude = max(0.12, 0.64 * uSwellGain * swellEnvelope(depth, c.a));
    float crestEvent = smoothstep(0.45, 1.05, crest / amplitude);
    float exposure = smoothstep(0.08, 0.65, c.a);
    return instability * crestEvent * smoothstep(0.05, 0.5, depth)
      * (1.0 - smoothstep(9.0, 18.0, depth)) * exposure
      + compression * 0.10 * exposure;
  }
`;

export const historyGLSL = /* glsl */ `
  uniform sampler2D uFoamWide, uFoamNear;
  uniform vec3 uFoamRegion;
  uniform float uFoamDetail;
  vec4 coastalHistory(vec2 p) {
    vec2 wideUV = p / 380.0 + vec2(0.5);
    float wideEdge = max(abs(wideUV.x - 0.5), abs(wideUV.y - 0.5));
    vec4 wide = vec4(0.0);
    if (wideEdge < 0.498) wide = texture2D(uFoamWide, clamp(wideUV, vec2(0.001), vec2(0.999))) * (1.0 - smoothstep(0.475, 0.498, wideEdge));
    vec2 uv = (p - uFoamRegion.xy) / uFoamRegion.z + vec2(0.5);
    float blend = (1.0 - smoothstep(0.32, 0.47, max(abs(uv.x - 0.5), abs(uv.y - 0.5)))) * uFoamDetail;
    if (blend < 0.001) return wide;
    return mix(wide, texture2D(uFoamNear, clamp(uv, vec2(0.001), vec2(0.999))), blend);
  }
`;

export const bathymetryGLSL = /* glsl */ `
  float bedHeight(vec2 p) {
    vec2 uv = p / uTerrainSize + vec2(0.5);
    if (max(abs(uv.x - 0.5), abs(uv.y - 0.5)) > 0.498) return -190.0;
    return texture2D(uHeightMap, uv).r;
  }
  float shoreAttenuation(float depth) { return swellEnvelope(max(0.05, depth), 1.0); }
`;

export const microSurfaceGLSL = /* glsl */ `
  vec3 microSurface(vec2 p, float footprint, float shelter) {
    vec2 windP = windCoordinates(p);
    float patches = 0.62 + 0.38 * sin(dot(p, vec2(0.013, 0.019)) - uTime * 0.034)
      * sin(dot(p, vec2(-0.027, 0.009)) + uTime * 0.023);
    float strength = (0.24 + 0.76 * min(1.8, uSurfaceWind)) * mix(0.65, 1.0, shelter) * patches;
    if (footprint > 0.35) return vec3(0.0, 0.0, 0.5 * 0.018 * 0.018 * strength * strength * (1.0 - pow(0.87, 12.0)) / (1.0 - 0.87 * 0.87));
    vec2 slope = vec2(0.0);
    float variance = 0.0;
    for (int i = 0; i < 6; i++) {
      float f = float(i);
      float angle = -0.65 + f * 0.267 + 0.15 * sin(f * 4.7);
      vec2 direction = vec2(cos(angle), sin(angle));
      float k = 21.0 * pow(1.53, f);
      float omega = sqrt(9.81 * k + 0.000074 * k * k * k);
      float phase = dot(windP, direction) * k - uTime * omega + sin(dot(p, vec2(0.37, -0.29)) + f) * 0.3;
      float amplitude = 0.018 * pow(0.87, f) * strength;
      float bandFilter = exp(-0.18 * k * k * footprint * footprint);
      slope += direction * cos(phase) * amplitude * bandFilter;
      variance += amplitude * amplitude * 0.5 * (1.0 - bandFilter * bandFilter);
    }
    return vec3(turnWind(slope), variance);
  }
`;
