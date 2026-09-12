import * as THREE from 'three';
import { noiseGLSL } from './NoiseGLSL';
import { createFloatTarget, createSimulationMaterial, runSimulationPass } from './SpectralCascade';

export interface FoamLevel {
  size: number;
  region: THREE.Vector3;
  elapsed: number;
  targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  index: number;
}

export interface FoamSystemOptions {
  compact: boolean;
  renderer: THREE.WebGLRenderer;
  simulationScene: THREE.Scene;
  simulationCamera: THREE.Camera;
  simulationQuad: THREE.Mesh;
  uniforms: { [key: string]: THREE.IUniform };
  spectrumGLSL: string;
}

export class FoamSystem {
  uniforms: {
    uFoamWide: { value: THREE.Texture | null };
    uFoamNear: { value: THREE.Texture | null };
    uFoamRegion: { value: THREE.Vector3 };
    uFoamDetail: { value: number };
  };
  levels: FoamLevel[];
  material: THREE.ShaderMaterial;

  private renderer: THREE.WebGLRenderer;
  private simScene: THREE.Scene;
  private simCamera: THREE.Camera;
  private simQuad: THREE.Mesh;
  private dummyTex: THREE.DataTexture;

  constructor(options: FoamSystemOptions) {
    const { compact, renderer, simulationScene, simulationCamera, simulationQuad, uniforms, spectrumGLSL } = options;
    this.renderer = renderer;
    this.simScene = simulationScene;
    this.simCamera = simulationCamera;
    this.simQuad = simulationQuad;

    this.uniforms = {
      uFoamWide: { value: null },
      uFoamNear: { value: null },
      uFoamRegion: { value: new THREE.Vector3(20, 50, 64) },
      uFoamDetail: { value: 0 },
    };

    this.levels = [
      {
        size: compact ? 512 : 768,
        region: new THREE.Vector3(0, 0, 380),
        elapsed: 0,
        targets: [createFloatTarget(compact ? 512 : 768, compact ? 512 : 768), createFloatTarget(compact ? 512 : 768, compact ? 512 : 768)],
        index: 0,
      },
      {
        size: compact ? 384 : 512,
        region: this.uniforms.uFoamRegion.value.clone(),
        elapsed: 0,
        targets: [createFloatTarget(compact ? 384 : 512, compact ? 384 : 512), createFloatTarget(compact ? 384 : 512, compact ? 384 : 512)],
        index: 0,
      },
    ];

    this.dummyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    this.dummyTex.needsUpdate = true;

    this.material = createSimulationMaterial(
      {
        ...uniforms,
        uFoamWide: { value: this.dummyTex },
        uFoamNear: { value: this.dummyTex },
        uPrevious: { value: this.dummyTex },
        uRegion: { value: new THREE.Vector3() },
        uPreviousRegion: { value: new THREE.Vector3() },
        uSize: { value: 768 },
        uDelta: { value: 1 / 30 },
        uNear: { value: 0 },
      },
      /* glsl */ `
        uniform sampler2D uHeightMap, uPrevious, uFoamWide;
        uniform vec3 uRegion, uPreviousRegion;
        uniform float uTime, uSize, uDelta, uStorm, uNear;
        ${noiseGLSL}
        ${spectrumGLSL}
        vec4 previousAt(vec2 p) {
          vec2 uv = (p - uPreviousRegion.xy) / uPreviousRegion.z + vec2(0.5);
          vec4 result = vec4(0.0);
          if (max(abs(uv.x - 0.5), abs(uv.y - 0.5)) > 0.496) {
            if (uNear > 0.5) {
              result = texture2D(uFoamWide, clamp(p / 380.0 + vec2(0.5), vec2(0.001), vec2(0.999)));
            }
          } else {
            result = texture2D(uPrevious, uv);
          }
          return result;
        }
        void main() {
          vec2 uv = gl_FragCoord.xy / uSize;
          vec2 p = uRegion.xy + (uv - vec2(0.5)) * uRegion.z;
          vec4 bed = texture2D(uHeightMap, p / 550.0 + vec2(0.5));
          if (bed.g > 2.1) { gl_FragColor = vec4(0.0); return; }
          float interactionDepth = max(0.05, -bed.r);
          if (interactionDepth >= 40.0) { gl_FragColor = vec4(0.0); return; }
          if (interactionDepth > 28.0) {
            vec4 old = previousAt(p - uWindDirection * (0.22 + uSurfaceWind * 0.18) * uDelta);
            float coverage = old.r * exp(-uDelta / mix(4.0, 12.0, uStorm));
            gl_FragColor = vec4(coverage, old.g * exp(-uDelta * 0.85), 0.0, 0.0);
            return;
          }
          float stepSize = 1.8;
          vec2 grad = vec2(
            texture2D(uHeightMap, (p + vec2(stepSize, 0.0)) / 550.0 + vec2(0.5)).r - texture2D(uHeightMap, (p - vec2(stepSize, 0.0)) / 550.0 + vec2(0.5)).r,
            texture2D(uHeightMap, (p + vec2(0.0, stepSize)) / 550.0 + vec2(0.5)).r - texture2D(uHeightMap, (p - vec2(0.0, stepSize)) / 550.0 + vec2(0.5)).r
          ) / (2.0 * stepSize);
          vec2 inland = grad * inversesqrt(max(dot(grad, grad), 1e-8));
          vec4 coast = coastField(p);
          float depth = max(0.05, -bed.g);
          vec3 wave = waveDisplacement(p, uRegion.z / uSize, 1.0);
          vec2 slope = waveSlopeFiltered(p, uRegion.z / uSize, 1.0);
          float compression = smoothstep(0.3, 0.75, length(slope)) * smoothstep(0.1, 0.8, wave.y);
          float breaking = clamp(breakerPotential(p, wave.y, compression), 0.0, 1.0);
          vec4 local = previousAt(p);
          vec2 shoreSource = p - inland * (10.0 + max(0.0, bed.g) * 5.0);
          vec3 arriving = waveDisplacement(shoreSource, 0.65, 1.0);
          float runPulse = smoothstep(-0.10, 0.40, arriving.y);
          float surf = 1.0 - smoothstep(0.4, 6.0, depth);
          vec2 flow = coast.yz * (0.32 + breaking * 1.7) + uWindDirection * uSurfaceWind * 0.14 * coast.a;
          flow += inland * surf * (runPulse * 1.8 - 0.65 - local.b * 0.35);
          float eddy = sin(dot(p, vec2(0.52, 0.37)) - uTime * 0.8) * cos(dot(p, vec2(-0.27, 0.43)) + uTime * 0.57);
          flow += vec2(-grad.y, grad.x) * clamp(bed.b * 5.0 + local.r * 1.8, 0.0, 3.0) * eddy;
          flow -= inland * max(0.0, dot(flow, inland)) * smoothstep(0.0, 0.7, bed.r) * bed.b;
          float speed = length(flow);
          flow *= min(1.0, 4.5 / max(0.001, speed));
          vec2 advected = p - flow * uDelta;
          vec4 old = previousAt(advected);
          float life = mix(2.8, 7.0, coast.a) * mix(1.0, 1.4, uStorm);
          float foam = old.r * exp(-uDelta / life);
          float fresh = old.g * exp(-uDelta * 0.85);
          float shallowSlope = length(grad);
          float runupGain = mix(1.55, 0.8, smoothstep(0.10, 0.45, shallowSlope));
          float reach = clamp(0.08 + max(0.0, arriving.y) * runupGain + breaking * 0.23, 0.0, 1.6);
          reach *= 0.8 + 0.2 * noise2(p * 0.29 + flow * uTime * 0.06);
          float water = max(0.0, reach - bed.g) * (1.0 - smoothstep(0.5, 2.0, bed.g));
          float swash = mix(local.b, clamp(water, 0.0, 0.22), 1.0 - exp(-uDelta * (water > local.b ? 4.0 : 0.75)));
          float impact = bed.b * smoothstep(-1.5, 0.1, bed.r) * compression * 0.65;
          float surfSource = 1.0 - smoothstep(14.0, 28.0, interactionDepth);
          float source = (breaking * 0.50 + compression * 0.025 * coast.a) * surfSource + impact;
          source += smoothstep(0.025, 0.11, swash) * (1.0 - smoothstep(0.0, 0.45, swash)) * smoothstep(-0.35, 0.08, bed.g) * runPulse * 0.10;
          float deposited = 1.0 - exp(-uDelta * source * 1.7);
          foam = clamp(foam + (1.0 - foam) * deposited, 0.0, 1.0);
          fresh = max(fresh, deposited * 3.5);
          float wet = max(local.a * exp(-uDelta / 38.0), smoothstep(0.008, 0.07, swash));
          foam *= 1.0 - smoothstep(0.05, 0.8, bed.r) * bed.b;
          gl_FragColor = vec4(foam, clamp(fresh, 0.0, 1.0), swash, wet);
        }
      `,
      'FoamSystem_Sim'
    );

    const clearMat = createSimulationMaterial({}, 'void main() { gl_FragColor = vec4(0.0); }', 'FoamSystem_Clear');
    this.levels.forEach((level) => {
      for (const target of level.targets) {
        target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
        target.texture.wrapS = target.texture.wrapT = THREE.ClampToEdgeWrapping;
        runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, clearMat, target);
      }
    });

    this.uniforms.uFoamWide.value = this.levels[0].targets[0].texture;
    this.uniforms.uFoamNear.value = this.levels[1].targets[0].texture;
  }

  update(delta: number, camera: THREE.Camera, target: THREE.Vector3, quality: number) {
    const vx = target.x - camera.position.x;
    const vz = target.z - camera.position.z;
    const length = Math.max(1, Math.hypot(vx, vz));
    const ahead = Math.min(length, Math.max(18, Math.min(42, camera.position.y * 2.4)));
    const focusX = camera.position.x + (vx / length) * ahead;
    const focusZ = camera.position.z + (vz / length) * ahead;
    const detail = camera.position.y < 65 ? 1 : 0;
    this.uniforms.uFoamDetail.value += (detail - this.uniforms.uFoamDetail.value) * (1 - Math.exp(-delta * 2));

    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      if (i === 1 && detail === 0 && this.uniforms.uFoamDetail.value < 0.005) {
        level.elapsed = 0;
        continue;
      }
      level.elapsed += delta;
      const interval = i === 0 ? (quality < 0.7 ? 1 / 10 : 1 / 15) : quality < 0.7 ? 1 / 24 : 1 / 30;
      if (level.elapsed < interval) continue;
      const dt = Math.min(level.elapsed, 0.12);
      level.elapsed = 0;

      this.material.uniforms.uPreviousRegion.value.copy(level.region);
      if (i === 1) {
        level.region.set(Math.round(focusX / 4) * 4, Math.round(focusZ / 4) * 4, 64);
        this.material.uniforms.uFoamWide.value = this.levels[0].targets[this.levels[0].index].texture;
      } else {
        this.material.uniforms.uFoamWide.value = this.dummyTex;
      }
      this.material.uniforms.uRegion.value.copy(level.region);
      this.material.uniforms.uPrevious.value = level.targets[level.index].texture;
      this.material.uniforms.uSize.value = level.size;
      this.material.uniforms.uDelta.value = dt;
      this.material.uniforms.uNear.value = i;
      const nextIndex = 1 - level.index;
      runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.material, level.targets[nextIndex]);
      level.index = nextIndex;
      this.uniforms[i ? 'uFoamNear' : 'uFoamWide'].value = level.targets[level.index].texture;
    }
    this.renderer.setRenderTarget(null);
    this.uniforms.uFoamRegion.value.copy(this.levels[1].region);
  }
}
