import * as THREE from 'three';
import { coastalGLSL } from './CoastalField';

export interface SpectralCascadeOptions {
  length: number;
  minWave: number;
  maxWave: number;
  rms: number;
  direction: number;
  fftSize: number;
  renderer: THREE.WebGLRenderer;
  simulationScene: THREE.Scene;
  simulationCamera: THREE.Camera;
  simulationQuad: THREE.Mesh;
  timeUniform: { value: number };
}

export function createSimulationMaterial(
  uniforms: { [key: string]: THREE.IUniform },
  fragmentShader: string,
  name = 'SimulationMaterial'
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createFloatTarget(
  width: number,
  height: number,
  mipmaps = false
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
  });
  target.samples = 0;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  target.texture.wrapS = target.texture.wrapT = THREE.RepeatWrapping;
  return target;
}

export function runSimulationPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quad: THREE.Mesh,
  material: THREE.Material,
  target: THREE.WebGLRenderTarget
) {
  quad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
}

export class SpectralCascade {
  length: number;
  size: number;
  ping: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  displacement: THREE.WebGLRenderTarget;
  normals: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  normalIndex: number;
  evolve: THREE.ShaderMaterial;
  transform: THREE.ShaderMaterial;
  pack: THREE.ShaderMaterial;
  derive: THREE.ShaderMaterial;

  private renderer: THREE.WebGLRenderer;
  private simScene: THREE.Scene;
  private simCamera: THREE.Camera;
  private simQuad: THREE.Mesh;

  constructor(options: SpectralCascadeOptions) {
    const { length, minWave, maxWave, rms, direction, fftSize, renderer, simulationScene, simulationCamera, simulationQuad, timeUniform } = options;
    this.length = length;
    this.size = fftSize;
    this.renderer = renderer;
    this.simScene = simulationScene;
    this.simCamera = simulationCamera;
    this.simQuad = simulationQuad;

    this.ping = [createFloatTarget(fftSize, fftSize), createFloatTarget(fftSize, fftSize)];
    this.displacement = createFloatTarget(fftSize, fftSize, true);
    this.normals = [createFloatTarget(fftSize, fftSize, true), createFloatTarget(fftSize, fftSize, true)];
    this.normalIndex = 0;

    const TAU = Math.PI * 2;
    let seed = 192731;
    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-8, random()))) * Math.cos(TAU * random());
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    const coefficients = new Float32Array(fftSize * fftSize * 2);
    const initial = new Float32Array(fftSize * fftSize * 4);
    const deltaK = TAU / length;
    const peakOmega = Math.sqrt((9.81 * TAU) / 78);
    let energy = 0;

    for (let z = 0; z < fftSize; z++) {
      for (let x = 0; x < fftSize; x++) {
        const kx = (x < fftSize / 2 ? x : x - fftSize) * deltaK;
        const kz = (z < fftSize / 2 ? z : z - fftSize) * deltaK;
        const k = Math.hypot(kx, kz);
        const index = (z * fftSize + x) * 2;
        if (k < 0.00001) continue;
        const wavelength = TAU / k;
        const band = smooth(minWave, minWave * 1.35, wavelength) * (1 - smooth(maxWave * 0.75, maxWave, wavelength));
        if (band === 0) continue;
        const omega = Math.sqrt(9.81 * k);
        const sigma = omega <= peakOmega ? 0.07 : 0.09;
        const peak = Math.exp(-0.5 * (((omega - peakOmega) / (sigma * peakOmega)) ** 2));
        const jonswap = (0.0081 * 9.81 ** 2) / omega ** 5 * Math.exp(-1.25 * ((peakOmega / omega) ** 4)) * (3.3 ** peak);
        const alignment = (kx * Math.cos(direction) + kz * Math.sin(direction)) / k;
        const spreading = 0.97 * (Math.max(alignment, 0) ** (length > 1000 ? 14 : 3)) + 0.015;
        const density = jonswap * 0.5 * Math.sqrt(9.81 / k) / k * spreading * (deltaK ** 2) * band;
        const amplitude = Math.sqrt(density * 0.5);
        coefficients[index] = gaussian() * amplitude;
        coefficients[index + 1] = gaussian() * amplitude;
        energy += coefficients[index] ** 2 + coefficients[index + 1] ** 2;
      }
    }

    const scale = rms / Math.sqrt(Math.max(1e-15, energy * 2));
    for (let z = 0; z < fftSize; z++) {
      for (let x = 0; x < fftSize; x++) {
        const i = (z * fftSize + x) * 4;
        const k = i / 2;
        const opposite = (((fftSize - z) % fftSize) * fftSize + ((fftSize - x) % fftSize)) * 2;
        initial[i] = coefficients[k] * scale;
        initial[i + 1] = coefficients[k + 1] * scale;
        initial[i + 2] = coefficients[opposite] * scale;
        initial[i + 3] = coefficients[opposite + 1] * scale;
      }
    }

    const initialTexture = new THREE.DataTexture(initial, fftSize, fftSize, THREE.RGBAFormat, THREE.FloatType);
    initialTexture.needsUpdate = true;

    this.evolve = createSimulationMaterial(
      {
        uInitial: { value: initialTexture },
        uTime: timeUniform,
        uSize: { value: fftSize },
        uLength: { value: length },
      },
      /* glsl */ `
        uniform sampler2D uInitial;
        uniform float uTime, uLength, uSize;
        vec2 multiplyComplex(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
        void main() {
          vec2 cell = floor(gl_FragCoord.xy);
          vec2 k = cell;
          if (cell.x >= uSize * 0.5) k.x -= uSize;
          if (cell.y >= uSize * 0.5) k.y -= uSize;
          k *= 6.283185307 / uLength;
          float magnitude = length(k);
          if (magnitude < 0.00001) { gl_FragColor = vec4(0.0); return; }
          float omega = sqrt(9.81 * magnitude * (1.0 + magnitude * magnitude * 0.000074));
          vec2 rotation = vec2(cos(omega * uTime), sin(omega * uTime));
          vec4 initial = texture2D(uInitial, (cell + vec2(0.5)) / uSize);
          vec2 h = multiplyComplex(initial.xy, vec2(rotation.x, -rotation.y)) + multiplyComplex(vec2(initial.z, -initial.w), rotation);
          vec2 d = k / magnitude;
          vec2 packedDisplacement = vec2(-h.y * d.x - h.x * d.y, h.x * d.x - h.y * d.y);
          gl_FragColor = vec4(h, packedDisplacement);
        }
      `,
      'SpectralCascade_Evolve'
    );

    this.transform = createSimulationMaterial(
      {
        uInput: { value: null },
        uStep: { value: 2 },
        uSize: { value: fftSize },
        uHorizontal: { value: 1 },
      },
      /* glsl */ `
        uniform sampler2D uInput;
        uniform float uStep, uSize, uHorizontal;
        vec2 multiplyComplex(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
        void main() {
          vec2 cell = floor(gl_FragCoord.xy);
          float index = uHorizontal > 0.5 ? cell.x : cell.y;
          float evenIndex = floor(index / uStep) * uStep * 0.5 + mod(index, uStep * 0.5);
          vec2 evenCell = uHorizontal > 0.5 ? vec2(evenIndex, cell.y) : vec2(cell.x, evenIndex);
          vec2 oddCell = evenCell + (uHorizontal > 0.5 ? vec2(uSize * 0.5, 0.0) : vec2(0.0, uSize * 0.5));
          vec4 evenValue = texture2D(uInput, (evenCell + vec2(0.5)) / uSize);
          vec4 oddValue = texture2D(uInput, (oddCell + vec2(0.5)) / uSize);
          float angle = 6.283185307 * index / uStep;
          vec2 twiddle = vec2(cos(angle), sin(angle));
          gl_FragColor = evenValue + vec4(multiplyComplex(twiddle, oddValue.xy), multiplyComplex(twiddle, oddValue.zw));
        }
      `,
      'SpectralCascade_Transform'
    );

    this.pack = createSimulationMaterial(
      {
        uInput: { value: null },
        uGain: { value: 1.0 },
        uSize: { value: fftSize },
      },
      /* glsl */ `
        uniform sampler2D uInput;
        uniform float uGain, uSize;
        void main() {
          vec4 field = texture2D(uInput, gl_FragCoord.xy / uSize);
          float chop = min(2.0, pow(uGain, 0.75)) * 1.05;
          gl_FragColor = vec4(field.b * chop, field.r * uGain, field.a * chop, 1.0);
        }
      `,
      'SpectralCascade_Pack'
    );

    this.derive = createSimulationMaterial(
      {
        uDisplacement: { value: this.displacement.texture },
        uPrevious: { value: this.normals[0].texture },
        uSize: { value: fftSize },
        uLength: { value: length },
        uDelta: { value: 1 / 60 },
        uFoamStorm: { value: 0 },
      },
      /* glsl */ `
        uniform sampler2D uDisplacement, uPrevious;
        uniform float uSize, uLength, uDelta, uFoamStorm;
        void main() {
          vec2 uv = gl_FragCoord.xy / uSize, texel = vec2(1.0 / uSize, 0.0);
          vec3 dx = (texture2D(uDisplacement, uv + texel.xy).xyz - texture2D(uDisplacement, uv - texel.xy).xyz) * uSize / (2.0 * uLength);
          vec3 dz = (texture2D(uDisplacement, uv + texel.yx).xyz - texture2D(uDisplacement, uv - texel.yx).xyz) * uSize / (2.0 * uLength);
          vec3 n = cross(vec3(dz.x, dz.y, 1.0 + dz.z), vec3(1.0 + dx.x, dx.y, dx.z));
          n *= inversesqrt(max(dot(n, n), 1e-12));
          vec2 slope = clamp(-n.xz / max(0.25, n.y), vec2(-4.0), vec2(4.0));
          float jacobian = (1.0 + dx.x) * (1.0 + dz.z) - dx.z * dz.x;
          float previous = texture2D(uPrevious, uv - vec2(1.9, 0.8) * uDelta / uLength).b;
          float breaking = smoothstep(0.22, 0.48, 1.0 - jacobian);
          float foam = max(previous * exp(-uDelta * mix(0.62, 0.35, uFoamStorm)), breaking);
          float crest = texture2D(uDisplacement, uv).y;
          gl_FragColor = vec4(slope, foam, crest);
        }
      `,
      'SpectralCascade_Derive'
    );

    const clearMat = createSimulationMaterial({}, 'void main() { gl_FragColor = vec4(0.0); }', 'SpectralCascade_Clear');
    for (const target of this.normals) {
      runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, clearMat, target);
    }
    this.renderer.setRenderTarget(null);
  }

  update(delta: number) {
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.evolve, this.ping[0]);
    let index = 0;
    for (let axis = 0; axis < 2; axis++) {
      this.transform.uniforms.uHorizontal.value = axis === 0 ? 1 : 0;
      for (let size = 2; size <= this.size; size *= 2) {
        this.transform.uniforms.uInput.value = this.ping[index].texture;
        this.transform.uniforms.uStep.value = size;
        index = 1 - index;
        runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.transform, this.ping[index]);
      }
    }
    this.pack.uniforms.uInput.value = this.ping[index].texture;
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.pack, this.displacement);
    this.derive.uniforms.uPrevious.value = this.normals[this.normalIndex].texture;
    this.derive.uniforms.uDelta.value = delta;
    this.normalIndex = 1 - this.normalIndex;
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.derive, this.normals[this.normalIndex]);
  }
}

export function buildSpectralLODGLSL(fftResolutions: number[]): string {
  return /* glsl */ `
    vec3 spectralLOD(float footprint) {
      return max(vec3(0.0), log2(max(vec3(0.001), footprint * vec3(${fftResolutions.map((size) => size.toFixed(1)).join(', ')}) / vec3(1792.0, 211.0, 27.3))));
    }
  `;
}

export function buildWaveDisplacementGLSL(): string {
  return /* glsl */ `
    uniform sampler2D uDisplacement0, uDisplacement1, uDisplacement2;
    vec3 waveDisplacement(vec2 p, float footprint, float attenuation) {
      vec3 lod = spectralLOD(footprint);
      vec4 c = coastField(p);
      float depth = coastalDepth(p);
      vec3 swell = texture2D(uDisplacement0, swellCoordinates(p, c) / 1792.0).xyz;
      float wavePhase = (p.x * 0.035 + p.y * 0.018) - uTime * 0.85;
      float wavePhase2 = (p.x * -0.02 + p.y * 0.04) - uTime * 1.15;
      vec3 proceduralSwell = vec3(
        cos(wavePhase) * 0.35 + sin(wavePhase2) * 0.2,
        sin(wavePhase) * 0.75 + cos(wavePhase2) * 0.45,
        sin(wavePhase) * 0.25 - cos(wavePhase2) * 0.3
      ) * uSwellGain;
      swell += proceduralSwell;
      float along = dot(swell.xz, vec2(0.886995, 0.461779));
      float steepening = (1.0 - smoothstep(2.0, 12.0, depth)) * sqrt(c.a);
      float rms = max(0.2, 0.64 * uSwellGain);
      float skew = clamp((0.17 * (swell.y * swell.y - along * along) - 0.19 * swell.y * along) / rms, -0.4 * rms, 0.5 * rms);
      swell.y += skew * steepening;
      swell.xz = turnSwell(swell.xz, c.yz) * mix(1.0, 1.24, steepening);
      float failure = smoothstep(0.50, 0.95, 1.5 * uSwellGain * sqrt(c.a) / max(0.3, depth));
      float lip = smoothstep(0.28, 0.88, swell.y / rms) * failure;
      swell.xz += c.yz * lip * rms * 0.28;
      swell.y += lip * rms * 0.065;
      swell *= swellEnvelope(depth, c.a) * energyRegion(p);
      vec2 windP = windCoordinates(p);
      vec3 sea = texture2D(uDisplacement1, windP / 211.0).xyz;
      vec3 shortSea = texture2D(uDisplacement2, windP / 27.3).xyz;
      sea.xz = turnWind(sea.xz);
      shortSea.xz = turnWind(shortSea.xz);
      float shoreFade = smoothstep(0.015, 0.8, depth) * energyRegion(p);
      return swell + (sea * mix(0.38, 1.0, c.a) + shortSea * mix(0.68, 1.0, c.a)) * shoreFade;
    }
  `;
}

export function buildWaveSlopeGLSL(): string {
  return /* glsl */ `
    uniform sampler2D uSlope0, uSlope1, uSlope2;
    vec2 waveSlopeFiltered(vec2 p, float footprint, float attenuation) {
      vec3 lod = spectralLOD(footprint);
      vec4 c = coastField(p);
      float depth = coastalDepth(p);
      vec4 wave0 = texture2D(uSlope0, swellCoordinates(p, c) / 1792.0);
      vec2 swell = wave0.xy;
      float crest = wave0.a;
      float wavePhase = (p.x * 0.035 + p.y * 0.018) - uTime * 0.85;
      float wavePhase2 = (p.x * -0.02 + p.y * 0.04) - uTime * 1.15;
      vec2 proceduralSlope = vec2(
        cos(wavePhase) * 0.035 * 0.75 - sin(wavePhase2) * 0.02 * 0.45,
        cos(wavePhase) * 0.018 * 0.75 + sin(wavePhase2) * 0.04 * 0.45
      ) * uSwellGain;
      swell += proceduralSlope;
      crest += (sin(wavePhase) * 0.75 + cos(wavePhase2) * 0.45) * uSwellGain;
      float phaseCompression = min(3.6, inversesqrt(max(0.05, tanh(0.08055 * depth))));
      swell += vec2(0.886995, 0.461779) * dot(swell, vec2(0.886995, 0.461779)) * (phaseCompression - 1.0);
      float steepening = (1.0 - smoothstep(2.0, 12.0, depth)) * sqrt(c.a);
      swell *= 1.0 + steepening * clamp((0.35 * crest - 0.30 * dot(-swell * 3.0, vec2(0.886995, 0.461779))) / max(0.2, 0.64 * uSwellGain), -0.35, 0.8);
      swell = turnSwell(swell, c.yz) * swellEnvelope(depth, c.a) * energyRegion(p);
      vec2 windP = windCoordinates(p);
      vec2 sea = texture2D(uSlope1, windP / 211.0).xy * mix(0.38, 1.0, c.a)
        + texture2D(uSlope2, windP / 27.3).xy * mix(0.68, 1.0, c.a);
      return swell + turnWind(sea) * smoothstep(0.015, 0.8, depth) * energyRegion(p);
    }
  `;
}

export function buildSpectrumVertGLSL(fftResolutions: number[]): string {
  return /* glsl */ `
    ${coastalGLSL}
    ${buildSpectralLODGLSL(fftResolutions)}
    ${buildWaveDisplacementGLSL()}
  `;
}

export function buildSpectrumFragGLSL(fftResolutions: number[]): string {
  return /* glsl */ `
    ${coastalGLSL}
    ${buildSpectralLODGLSL(fftResolutions)}
    ${buildWaveSlopeGLSL()}
  `;
}

export function buildSpectrumGLSL(fftResolutions: number[]): string {
  return /* glsl */ `
    ${coastalGLSL}
    ${buildSpectralLODGLSL(fftResolutions)}
    ${buildWaveDisplacementGLSL()}
    ${buildWaveSlopeGLSL()}
  `;
}
