import * as THREE from 'three';
import { generateStageGLSL, BREAKER_COMMON_GLSL, BreakerEvent } from './BreakerWave';

export class RollingWaterSurface extends THREE.Mesh {
  private customMaterial: THREE.ShaderMaterial;

  constructor() {
    // Dense geometry across the breaker zone (-6m to +3m z) fanning out seaward
    const nx = 96;
    const nz = 128;
    const xMin = -60, xMax = 60;
    const zMin = -60, zMax = 8;

    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uvs = new Float32Array((nx + 1) * (nz + 1) * 2);
    const indices: number[] = [];

    let pIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      // Exponential distribution giving more rows in the breaker zone (z between -10 and 2)
      let z: number;
      if (v < 0.6) {
        // Seaward deep water
        const t = v / 0.6;
        z = zMin + t * (-10.0 - zMin);
      } else {
        // Breaker and swash zone
        const t = (v - 0.6) / 0.4;
        z = -10.0 + t * (zMax - (-10.0));
      }

      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const x = xMin + u * (xMax - xMin);

        pos[pIdx++] = x;
        pos[pIdx++] = 0;
        pos[pIdx++] = z;

        uvs[uvIdx++] = u;
        uvs[uvIdx++] = v;
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
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 150);

    const stageGLSL = generateStageGLSL();

    const material = new THREE.ShaderMaterial({
      name: 'RollingWaterSurfaceMaterial',
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uDeepColor: { value: new THREE.Color(0x06435c) },
        uShallowColor: { value: new THREE.Color(0x27b9c9) },
        uFoamColor: { value: new THREE.Color(0xf4ffff) },
        uEvtCount: { value: 6 },
        uEvtA: { value: new Array(6).fill(0).map(() => new THREE.Vector4()) },
        uEvtB: { value: new Array(6).fill(0).map(() => new THREE.Vector4()) },
        uEvtC: { value: new Array(6).fill(0).map(() => new THREE.Vector4()) },
        uEvtD: { value: new Array(6).fill(0).map(() => new THREE.Vector4()) },
        uEvtE: { value: new Array(6).fill(0).map(() => new THREE.Vector4()) },
      },
      vertexShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vFoam;

        uniform float uTime;
        ${stageGLSL}
        ${BREAKER_COMMON_GLSL}

        // Background wind swell Gerstner wave
        vec3 windSwell(vec2 p, float t, inout vec3 n) {
          float k1 = 0.25;
          float w1 = sqrt(9.81 * k1);
          float ph1 = k1 * (p.y * 0.95 + p.x * 0.15) - w1 * t * 0.8;
          float a1 = 0.12;
          
          float k2 = 0.55;
          float w2 = sqrt(9.81 * k2);
          float ph2 = k2 * (p.y * 0.9 + p.x * -0.2) - w2 * t * 0.9;
          float a2 = 0.05;

          float dy = sin(ph1) * a1 + sin(ph2) * a2;
          float dx = -cos(ph1) * a1 * 0.15 - cos(ph2) * a2 * -0.2;
          float dz = -cos(ph1) * a1 * 0.95 - cos(ph2) * a2 * 0.9;

          n.x += -dx * 2.0;
          n.z += -dz * 2.0;
          return vec3(0.0, dy, 0.0);
        }

        void main() {
          vUv = uv;
          vec3 p = position;
          vec3 n = vec3(0.0, 1.0, 0.0);
          
          // Background swell
          vec3 swellDisp = windSwell(p.xz, uTime, n);
          p += swellDisp;

          // Breaker wave elevation and curling displacement
          vec3 breakerDisp = vec3(0.0);
          float breakerFoam = 0.0;
          float breakerY = brkElevation(p, uTime, breakerDisp, breakerFoam);
          
          p.y += breakerY;
          p.xz += breakerDisp.xz;
          vFoam = clamp(breakerFoam, 0.0, 1.0);

          // Analytic normal approximation via finite differences
          float eps = 0.05;
          vec3 dispX = vec3(0.0), dispZ = vec3(0.0);
          float foamDummy = 0.0;
          float yX = brkElevation(p + vec3(eps, 0.0, 0.0), uTime, dispX, foamDummy);
          float yZ = brkElevation(p + vec3(0.0, 0.0, eps), uTime, dispZ, foamDummy);
          
          n.x += (p.y - yX) / eps;
          n.z += (p.y - yZ) / eps;
          vNormal = normalize(normalMatrix * normalize(n));

          vec4 worldPos = modelMatrix * vec4(p, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vFoam;

        uniform vec3 uSunDirection;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;

        void main() {
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDirection);
          vec3 V = normalize(cameraPosition - vWorldPosition);

          float NdotL = max(dot(N, L), 0.0);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          
          // Depth gradient (shoaling from deep dark blue to luminous coastal turquoise)
          float depthFactor = smoothstep(-25.0, 0.5, vWorldPosition.z);
          vec3 waterBody = mix(uDeepColor, uShallowColor, depthFactor);

          // Subsurface scattering on thin wave crests
          float sss = pow(max(dot(V, -L), 0.0), 4.0) * smoothstep(0.1, 0.6, vWorldPosition.y) * 0.45;
          waterBody += vec3(0.1, 0.35, 0.28) * sss;

          // Sun specular glint
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 128.0) * 2.2;

          // Sky reflection mix
          vec3 skyReflect = mix(vec3(0.4, 0.65, 0.9), vec3(1.0, 0.95, 0.9), pow(NdotL, 4.0));
          vec3 surfColor = mix(waterBody, skyReflect, fresnel * 0.6);

          // Crest whitecap and crashing foam
          vec3 finalColor = mix(surfColor, uFoamColor, vFoam * 0.9) + vec3(spec);
          float alpha = mix(0.85, 0.98, vFoam);

          gl_FragColor = vec4(finalColor, alpha);
        }
      `
    });

    super(geometry, material);
    this.customMaterial = material;
    this.name = 'RollingWaterSurface';
    this.frustumCulled = false;
  }

  public updateUniforms(time: number, events: BreakerEvent[]) {
    this.customMaterial.uniforms.uTime.value = time;
    this.customMaterial.uniforms.uEvtCount.value = Math.min(events.length, 6);

    for (let i = 0; i < Math.min(events.length, 6); i++) {
      const e = events[i];
      (this.customMaterial.uniforms.uEvtA.value[i] as THREE.Vector4).set(e.t0, e.H, e.zI, e.seed);
      (this.customMaterial.uniforms.uEvtB.value[i] as THREE.Vector4).set(e.c, e.x0, e.wobble, e.strength);
      (this.customMaterial.uniforms.uEvtC.value[i] as THREE.Vector4).set(e.kappa, e.waviness, e.hvar, e.style);
      (this.customMaterial.uniforms.uEvtD.value[i] as THREE.Vector4).set(0.4, 0.004, 0.294, -0.155);
      (this.customMaterial.uniforms.uEvtE.value[i] as THREE.Vector4).set(e.hPeel, 0.75, 1.35, e.tilt);
    }
  }
}
