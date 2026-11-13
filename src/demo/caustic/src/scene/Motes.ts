import { AdditiveBlending, BufferAttribute, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Vector2 } from 'three';
import { CausticField, WATER_HEIGHT, causticCommonGLSL } from './CausticField';
import { floorHeight } from './Rotunda';

const MOTE_COUNT = 9000;

/**
 * Drifting particles that glint where caustic light crosses them. Each mote samples the caustic
 * map at the point where its sun ray meets the floor plane, so motes flash inside bright caustic
 * filaments and inside the sunlit shaft, and vanish in the shade. Plain GL points, additive.
 */
export class Motes {
  readonly points: Points;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;

  constructor(field: CausticField, aperture: Vector2) {
    const seeds = new Float32Array(MOTE_COUNT * 4);
    const floors = new Float32Array(MOTE_COUNT);
    let state = 8157;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const radius = Math.sqrt(random()) * 12.5;
      const angle = random() * Math.PI * 2;
      seeds.set([Math.cos(angle) * radius, random(), Math.sin(angle) * radius, random()], i * 4);
      floors[i] = floorHeight(radius) + 0.08;
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(MOTE_COUNT * 3), 3));
    this.geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    this.geometry.setAttribute('aFloor', new BufferAttribute(floors, 1));

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: field.uniforms.uTime,
        uWaveAmp: field.uniforms.uWaveAmp,
        uRipples: field.uniforms.uRipples,
        uCausticMap: field.uniforms.uCausticMap,
        uMeanRay: field.uniforms.uMeanRay,
        uAperture: { value: aperture },
        uSize: { value: 0.014 },
        uBrightness: { value: 2.4 },
        uOpacity: { value: 0.55 },
        uHaze: { value: 1.5 },
        uFogStart: { value: 4.5 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        ${causticCommonGLSL}
        uniform sampler2D uCausticMap;
        uniform vec3 uMeanRay;
        uniform vec2 uAperture;
        uniform float uSize;
        uniform float uBrightness;
        uniform float uHaze;
        uniform float uFogStart;
        attribute vec4 aSeed;
        attribute float aFloor;
        varying vec3 vColor;
        varying float vLit;
        void main() {
          float phase = aSeed.w * 6.2831853;
          float progress = fract(aSeed.y - uTime * (aSeed.w * 0.002 + 0.003));
          vec3 center = vec3(
            aSeed.x + sin(uTime * 0.15 + phase) * 0.22 + cos(uTime * 0.07 + aSeed.z) * 0.12,
            aFloor + progress * (WATER_HEIGHT - 0.08 - aFloor),
            aSeed.z + cos(uTime * 0.12 + phase) * 0.25 + sin(uTime * 0.09 + aSeed.x) * 0.14
          );
          vec2 q = center.xz - uMeanRay.xz / uMeanRay.y * center.y;
          vec3 irradiance = texture2D(uCausticMap, vec2(q.x / WAVE_TILE + 0.5, -q.y / WAVE_TILE + 0.5)).rgb / 0.22;
          vec2 shaftOffset = (center.xz - uAperture) / 4.0;
          float shaft = exp(-1.6 * dot(shaftOffset, shaftOffset));
          float glint = smoothstep(0.9, 2.6, dot(irradiance, vec3(0.2126, 0.7152, 0.0722)));
          float lit = clamp(glint + shaft * 0.5 + 0.04, 0.0, 1.0);

          vec4 mv = viewMatrix * vec4(center, 1.0);
          float distanceToEye = length(mv.xyz);
          vec3 extinction = exp(-vec3(0.30, 0.075, 0.045) * max(WATER_HEIGHT - center.y, 0.0));
          vec3 viewExtinction = exp(-vec3(0.018, 0.008, 0.004) * distanceToEye * uHaze);
          float fog = exp(-pow(max(distanceToEye - uFogStart, 0.0) * uHaze * 0.06, 2.0));
          float life = smoothstep(0.0, 0.04, progress) * (1.0 - smoothstep(0.96, 1.0, progress));
          float near = smoothstep(0.3, 0.8, distanceToEye);
          vColor = vec3(0.75, 1.0, 1.0) * uBrightness * extinction * viewExtinction * fog;
          vLit = lit * life * near;
          float diameter = uSize * (0.3 + 0.7 * aSeed.w);
          gl_PointSize = clamp(diameter * 1000.0 * projectionMatrix[1][1] / max(-mv.z, 0.1), 1.5, 6.0);
          gl_Position = vLit < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vLit;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r2 = dot(c, c) * 4.0;
          float disc = exp(-3.0 * r2) * (1.0 - smoothstep(0.7, 1.0, r2));
          float alpha = disc * uOpacity * vLit;
          gl_FragColor = vec4(vColor * alpha, alpha);
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.name = 'Suspended particles';
    this.points.frustumCulled = false;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
