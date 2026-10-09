import * as THREE from 'three';
import { SHORE_COMMON_GLSL } from './BreakerWave';

// Sandy coastal bed geometry with realistic shoaling slope, pebble berm, and wetness transition.
export class Shorebed extends THREE.Mesh {
  private customMaterial: THREE.ShaderMaterial;

  constructor() {
    const nx = 120;
    const nz = 110;
    const xMin = -150, xMax = 150;
    const zMin = -70, zMax = 40;

    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uvs = new Float32Array((nx + 1) * (nz + 1) * 2);
    const indices: number[] = [];

    // Piecewise beach bed profile (matching ShoreBreak bathymetry); must stay identical to
    // bedProfile() in BreakerWave.ts and C0-continuous at the segment joins
    const bedHeight = (z: number) => {
      if (z < -20.0) {
        return -3.14 + (z + 20.0) * 0.12;
      } else if (z < -2.0) {
        return -0.44 + (z + 2.0) * 0.15;
      } else if (z < 4.0) {
        return (z) * 0.22;
      } else {
        return 0.88 + (z - 4.0) * 0.08;
      }
    };

    let pIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      const z = zMin + v * (zMax - zMin);
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const x = xMin + u * (xMax - xMin);

        // Add subtle natural beach dune ripple variations
        const noise = Math.sin(x * 0.2) * Math.cos(z * 0.3) * 0.05 + Math.sin(x * 0.7 + z * 0.5) * 0.02;
        const y = bedHeight(z) + noise;

        pos[pIdx++] = x;
        pos[pIdx++] = y;
        pos[pIdx++] = z;

        uvs[uvIdx++] = u * 20.0;
        uvs[uvIdx++] = v * 20.0;
      }
    }

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = (j + 1) * (nx + 1) + i;
        const c = j * (nx + 1) + (i + 1);
        const d = (j + 1) * (nx + 1) + (i + 1);

        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      name: 'ShorebedMaterial',
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff2dc) },
        uSandColorDry: { value: new THREE.Color(0xd7c49e) },
        uSandColorWet: { value: new THREE.Color(0x6f5d42) },
        uHorizonColor: { value: new THREE.Color(0.55, 0.72, 0.9) },
        uWaterLevel: { value: 0.0 }
      },
      vertexShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;

        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSandColorDry;
        uniform vec3 uSandColorWet;
        uniform vec3 uHorizonColor;
        uniform float uWaterLevel;

        ${SHORE_COMMON_GLSL}

        void main() {
          vec3 P = vWorldPosition;
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDirection);
          vec3 toCam = cameraPosition - P;
          float dist = length(toCam);
          vec3 V = toCam / dist;

          // Wetness: the swash zone just above the still water line stays dark and glossy,
          // with a ragged drying edge that slowly breathes with the wave cycle
          float edgeWobble = fbm(P.xz * vec2(0.8, 2.0)) * 0.25 + 0.06 * sin(uTime * 0.35);
          float wetness = 1.0 - smoothstep(0.25 + edgeWobble, 0.65 + edgeWobble, P.y - uWaterLevel);
          float damp = 1.0 - smoothstep(0.6, 1.3, P.y - uWaterLevel);

          // grain: fine sand speckle + ripple marks left by the backwash
          float grain = hash12(floor(P.xz * 180.0));
          float ripples = sin(P.z * 28.0 + vnoise(P.xz * 3.0) * 4.0) * 0.5 + 0.5;
          float patches = fbm(P.xz * 0.6);
          vec3 dry = uSandColorDry * (0.9 + 0.2 * patches) * (0.93 + 0.14 * grain) * (0.97 + 0.06 * ripples);
          vec3 wet = uSandColorWet * (0.9 + 0.2 * patches) * (0.95 + 0.1 * grain);
          vec3 sandBase = mix(mix(dry, wet, damp * 0.35), wet, wetness);

          // dried foam / lace residue along the high-water line and shell fragments
          float residue = smoothstep(0.55, 0.75, fbm(P.xz * 2.2 + vec2(0.0, 3.0))) * smoothstep(0.2, 0.45, P.y) * (1.0 - smoothstep(0.5, 0.8, P.y));
          sandBase = mix(sandBase, vec3(0.78, 0.8, 0.78), residue * 0.6);

          float NdotL = max(dot(N, L), 0.0);
          vec3 light = uSunColor * (0.15 + 0.95 * NdotL) + uHorizonColor * 0.25;

          // Glossy sheen of the saturated sand mirrors the sky at grazing angles
          vec3 R = reflect(-V, N);
          float F = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 sky = mix(uHorizonColor, vec3(0.12, 0.3, 0.65), pow(clamp(R.y, 0.0, 1.0), 0.55));
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 120.0) * 1.2 + pow(max(dot(N, H), 0.0), 24.0) * 0.15;

          vec3 col = sandBase * light;
          col = mix(col, sky, F * 0.55 * wetness);
          col += uSunColor * spec * wetness;

          float fog = 1.0 - exp(-dist * 0.0022);
          col = mix(col, uHorizonColor * 0.95, fog);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });

    super(geometry, material);
    this.customMaterial = material;
    this.name = 'Shorebed';
    this.receiveShadow = true;
  }

  public setTime(time: number) {
    this.customMaterial.uniforms.uTime.value = time;
  }
}
