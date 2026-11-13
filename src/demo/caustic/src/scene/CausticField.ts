import {
  AddEquation,
  Color,
  CustomBlending,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/** Height of the still water surface above the floor. */
export const WATER_HEIGHT = 5.2;
/** The wave field is periodic over this tile; the caustic map covers one tile. */
export const WAVE_TILE = 4;
export const RIPPLE_COUNT = 4;
/** The column ring of the rotunda; shared with the shadow term of the sun. */
export const COLUMN_COUNT = 12;
export const COLUMN_RING_RADIUS = 7.7;
export const COLUMN_RADIUS = 0.44;
/** The sun hangs above the middle of the room, as in the original, so its rays fan out. */
export const SUN_HEIGHT = 8.5;
const RIPPLE_AMPLITUDE = 0.45;
const RIPPLE_FREQUENCY = 16;
const WATER_IOR = 1.333;
const MAP_SIZE = 1024;
const PHOTON_SEGMENTS = 192;
const PHOTON_EXTENT = WAVE_TILE + 2;
/** Flat water produces this much energy per spectral channel; normalised out on lookup. */
const FLAT_ENERGY = 0.22;

/** Spectral samples: rgb weights (each channel sums to one) and an index offset. */
const BANDS: Array<[number, number, number, number]> = [
  [0.55, 0, 0, -1],
  [0.35, 0.3, 0, -1 / 3],
  [0.1, 0.5, 0.3, 1 / 3],
  [0, 0.2, 0.7, 1],
];

export interface CausticUniforms {
  [key: string]: { value: any };
  uTime: { value: number };
  uWaveAmp: { value: number };
  uRipples: { value: Vector4[] };
  uCausticMap: { value: Texture | null };
  uMeanRay: { value: Vector3 };
  uRippleProj: { value: number };
  uCausticStrength: { value: number };
  uSunColor: { value: Color };
}

function f(n: number): string {
  const s = n.toFixed(6);
  return s;
}

/** Ten periodic waves (lattice wave vectors), unrolled into GLSL constants. */
function buildBaseWavesGLSL(): string {
  let body = '';
  for (let i = 0; i < 10; i++) {
    const angle = i * 2.399963 + 0.3;
    const frequency = (4.3 * Math.pow(1.22, i) * WAVE_TILE) / (Math.PI * 2);
    const amp = 0.01 * Math.pow(0.79, i);
    const x = (Math.round(Math.cos(angle) * frequency) * Math.PI * 2) / WAVE_TILE;
    const z = (Math.round(Math.sin(angle) * frequency) * Math.PI * 2) / WAVE_TILE;
    const k = Math.hypot(x, z);
    const speed = Math.sqrt(9.8 * k) * 0.32;
    body += `
    {
      vec2 d = vec2(${f(x / k)}, ${f(z / k)});
      float ph = dot(p, d) * ${f(k)} + uTime * ${f(speed)} + ${f(i * 7.13)};
      f += vec3(d * (cos(ph) * ${f(amp * k)}), sin(ph) * ${f(amp)}) * uWaveAmp;
    }`;
  }
  return `
  vec3 baseWaves(vec2 p) {
    vec3 f = vec3(0.0);
    ${body}
    return f;
  }`;
}

/** Shared by the caustic pass, water surface and every receiving material. */
export const causticCommonGLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform vec4 uRipples[${RIPPLE_COUNT}];
  #define WATER_HEIGHT ${f(WATER_HEIGHT)}
  #define WAVE_TILE ${f(WAVE_TILE)}
  ${buildBaseWavesGLSL()}

  // xy: slope, z: height, w: curvature
  vec4 rippleSample(vec2 p) {
    vec4 field = vec4(0.0);
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (age >= 0.0 && age < 14.0) {
        vec2 delta = p - r.xy;
        float dd = dot(delta, delta);
        float dist = sqrt(dd + 0.01);
        float front = dist - age * 0.85;
        float width = 0.48 + age * 0.1;
        float ws = width * width;
        float rate = dist * 0.35 + 1.0;
        float env = exp(-front * front / ws - age * 0.17) * r.w * ${f(RIPPLE_AMPLITUDE)} / sqrt(rate);
        float phase = (dist - age * 1.1) * ${f(RIPPLE_FREQUENCY)};
        float decay = -2.0 * front / ws - 0.175 / rate;
        float s = sin(phase);
        float c = cos(phase);
        float derivative = (c * ${f(RIPPLE_FREQUENCY)} + decay * s) * env;
        float decayDerivative = -2.0 / ws + 0.06125 / (rate * rate);
        float second = ((decay * decay + decayDerivative - ${f(RIPPLE_FREQUENCY * RIPPLE_FREQUENCY)}) * s
          + decay * ${f(2 * RIPPLE_FREQUENCY)} * c) * env;
        float radial = dd / (dist * dist);
        float curvature = second * radial + derivative * (2.0 - radial) / dist;
        field += vec4(delta / dist * derivative, s * env, curvature);
      }
    }
    return field;
  }

  vec3 allWaves(vec2 p) {
    return baseWaves(p) + rippleSample(p).xyz;
  }
`;

/**
 * Point sun above the room: the direction of the light that reaches `p` through the flat water
 * (pointing from the sun towards `p`), plus an analytic shadow cast by the column ring. The rays
 * fan out from the sun, so they slant onto the columns and the inner side of each one is lit.
 * Needs `causticCommonGLSL` for WATER_HEIGHT.
 */
export const causticSunGLSL = /* glsl */ `
  #define SUN_POS vec3(0.0, ${f(SUN_HEIGHT)}, 0.0)
  #define COLUMN_SECTOR ${f((Math.PI * 2) / COLUMN_COUNT)}
  #define COLUMN_RING ${f(COLUMN_RING_RADIUS)}
  #define COLUMN_R ${f(COLUMN_RADIUS)}

  vec3 sunRay(vec3 p) {
    vec3 d = normalize(p - SUN_POS);
    return p.y >= WATER_HEIGHT ? d : refract(d, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  }

  // 0 inside a column's shadow, 1 in the open. L points from the surface towards the sun. 'push'
  // moves the start off the surface so a column never shadows its own sunlit face. The sun rays
  // are nearly radial, so the nearest column by angle is the only one that can matter.
  float columnShadow(vec3 p, vec3 L, vec2 push) {
    float r = length(p.xz);
    if (r < 5.5 || r > 13.0) return 1.0;
    float tau = max(WATER_HEIGHT - p.y, 0.0) / max(L.y, 0.2);
    vec2 a = p.xz + push;
    vec2 ab = L.xz * tau;
    float k = floor(atan(p.x, p.z) / COLUMN_SECTOR);
    float c = (k + 0.5) * COLUMN_SECTOR;
    vec2 center = vec2(sin(c), cos(c)) * COLUMN_RING;
    float h = clamp(dot(center - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
    float d = length(center - a - ab * h);
    return smoothstep(COLUMN_R - 0.02, COLUMN_R + 0.2, d);
  }

  // True when p lies inside a column.
  bool insideColumn(vec3 p) {
    float r = length(p.xz);
    if (r < COLUMN_RING - 1.0 || r > COLUMN_RING + 1.0) return false;
    float k = floor(atan(p.x, p.z) / COLUMN_SECTOR);
    float c = (k + 0.5) * COLUMN_SECTOR;
    return length(p.xz - vec2(sin(c), cos(c)) * COLUMN_RING) < COLUMN_R;
  }
`;

/** Lookup of the caustic map plus the sun term applied to lit materials. Needs `causticSunGLSL`. */
export const causticReceiverGLSL = /* glsl */ `
  uniform sampler2D uCausticMap;
  uniform vec3 uMeanRay;
  uniform float uRippleProj;
  uniform float uCausticStrength;
  uniform vec3 uSunColor;

  vec3 causticIrradiance(vec3 p, vec3 ray) {
    vec4 rip = rippleSample(p.xz);
    vec2 q = p.xz - ray.xz / ray.y * p.y - rip.xy * uRippleProj;
    vec3 irr = texture2D(uCausticMap, vec2(q.x / WAVE_TILE + 0.5, -q.y / WAVE_TILE + 0.5)).rgb / ${f(FLAT_ENERGY)};
    float convergence = rip.w * max(WATER_HEIGHT - p.y, 0.0) * -0.12;
    float focusing = 1.0 + 0.85 * convergence / (abs(convergence) + 1.0);
    return irr * focusing;
  }

  vec3 causticLight(vec3 p, vec3 n) {
    vec3 L = -sunRay(p);
    // The map holds the light per square metre of horizontal floor, so a tilted receiver gets
    // dot(n, L) / L.y of it: the lit inner faces of the columns and the stair risers come out
    // as bright as the floor. A touch of wrap keeps grazing faces from going black.
    float ndl = clamp((dot(n, L) + 0.1) / 1.1, 0.0, 1.0) / max(L.y, 0.5);
    float depth = max(WATER_HEIGHT - p.y, 0.0);
    vec3 extinction = exp(-vec3(0.30, 0.075, 0.045) * depth);
    float visible = ndl > 0.0 ? columnShadow(p, L, n.xz * 0.08) : 0.0;
    return uSunColor * causticIrradiance(p, -L) * extinction * ndl * visible * uCausticStrength;
  }
`;

/**
 * Photon-mapping style caustics for a flat receiver plane. A grid of rays is refracted through the
 * wave normals; the density change between the grid on the surface and the grid where it lands
 * (measured with screen-space derivatives) becomes the light intensity. The result is rendered
 * additively into a tiling texture, one draw per spectral band for chromatic dispersion.
 */
export class CausticField {
  readonly uniforms: CausticUniforms;
  readonly sunDirection = new Vector3(-0.04, 1, -0.03).normalize();
  private readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly ripples: Vector4[];
  private rippleIndex = 1;

  constructor(private readonly renderer: WebGLRenderer) {
    this.ripples = Array.from({ length: RIPPLE_COUNT }, () => new Vector4(0, 0, -100, 0));

    this.target = new WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      type: HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
    });
    this.target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    // Refracted mean ray of the flat water: used to reproject receivers onto the map plane.
    const meanRay = this.refractDown(this.sunDirection);

    this.uniforms = {
      uTime: { value: 0 },
      uWaveAmp: { value: 1 },
      uRipples: { value: this.ripples },
      uCausticMap: { value: this.target.texture },
      uMeanRay: { value: meanRay },
      uRippleProj: { value: 1.25 },
      uCausticStrength: { value: 1 },
      uSunColor: { value: new Color(1.0, 0.94, 0.84).multiplyScalar(2.0) },
    };

    const geometry = new InstancedBufferGeometry();
    const plane = new PlaneGeometry(1, 1, PHOTON_SEGMENTS, PHOTON_SEGMENTS);
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.instanceCount = BANDS.length;
    const bandData = new Float32Array(BANDS.length * 4);
    BANDS.forEach((band, i) => bandData.set(band, i * 4));
    geometry.setAttribute('aBand', new InstancedBufferAttribute(bandData, 4));

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: this.uniforms.uTime,
        uWaveAmp: this.uniforms.uWaveAmp,
        uRipples: this.uniforms.uRipples,
        uSunDirection: { value: this.sunDirection },
        uCenterShift: { value: new Vector3(meanRay.x, 0, meanRay.z).multiplyScalar(WATER_HEIGHT / meanRay.y) },
        uDispersion: { value: 1.6 },
      },
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      toneMapped: false,
      vertexShader: /* glsl */ `
        ${causticCommonGLSL}
        attribute vec4 aBand;
        uniform vec3 uSunDirection;
        uniform vec3 uCenterShift;
        uniform float uDispersion;
        varying vec3 vSource;
        varying vec3 vTarget;
        varying vec3 vBandColor;
        void main() {
          vec2 source = position.xy * ${f(PHOTON_EXTENT)} + uCenterShift.xz;
          vec3 w = baseWaves(source);
          vec3 normal = normalize(vec3(-w.x, 1.0, -w.y));
          vec3 origin = vec3(source.x, w.z + WATER_HEIGHT, source.y);
          float ior = ${f(WATER_IOR)} + uDispersion * aBand.w * 0.055;
          vec3 ray = refract(-uSunDirection, normal, 1.0 / ior);
          float t = -origin.y / min(ray.y, -0.01);
          vec3 target = origin + ray * t;
          vSource = vec3(source.x, 0.0, source.y);
          vTarget = target;
          vBandColor = aBand.rgb;
          gl_Position = vec4(target.x / (WAVE_TILE * 0.5), -target.z / (WAVE_TILE * 0.5), 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vSource;
        varying vec3 vTarget;
        varying vec3 vBandColor;
        void main() {
          float before = length(cross(dFdx(vSource), dFdy(vSource)));
          float after = max(length(cross(dFdx(vTarget), dFdy(vTarget))), 1e-8);
          float energy = min(before / after, 16.0) * ${f(FLAT_ENERGY)};
          gl_FragColor = vec4(vBandColor * energy, 1.0);
        }
      `,
    });

    const mesh = new Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.rippleAt(0, 0, 0, 0.16, false);
  }

  /** Refract the downward sun ray through a flat water surface. */
  private refractDown(sun: Vector3): Vector3 {
    const incoming = sun.clone().negate();
    const eta = 1 / WATER_IOR;
    const cosI = -incoming.y;
    const k = 1 - eta * eta * (1 - cosI * cosI);
    return incoming
      .multiplyScalar(eta)
      .add(new Vector3(0, 1, 0).multiplyScalar(eta * cosI - Math.sqrt(k)));
  }

  setDispersion(value: number) {
    this.material.uniforms.uDispersion.value = value;
  }

  /** Emit a ripple born at the current water clock time. */
  rippleAt(x: number, z: number, born: number, strength = 0.13, advance = true) {
    const index = advance ? this.rippleIndex : 0;
    this.ripples[index].set(x, z, born, strength);
    if (advance) {
      this.rippleIndex = (this.rippleIndex + 1) % RIPPLE_COUNT || 1;
    }
  }

  clearRipples() {
    this.ripples.forEach((r) => r.set(0, 0, -100, 0));
    this.ripples[0].set(0, 0, 0, 0.16);
    this.rippleIndex = 1;
  }

  /** Bound the receiver-side inverse warp so strong ripples never fold the pattern. */
  private updateRippleProjection(time: number) {
    let curvature = 0;
    for (const r of this.ripples) {
      const age = time - r.z;
      if (age < 0 || age >= 14) continue;
      const width = 0.48 + age * 0.1;
      const height = Math.abs(r.w) * RIPPLE_AMPLITUDE * Math.exp(-age * 0.17);
      curvature +=
        height *
        (RIPPLE_FREQUENCY ** 2 +
          2 * RIPPLE_FREQUENCY * (Math.SQRT2 / width + 0.175) +
          2 / (width * width) +
          0.5 / width +
          0.1);
    }
    this.uniforms.uRippleProj.value = 1.25 / (1 + (curvature * 1.25) / 0.45);
  }

  /** Render the photon grid into the caustic map. Must run before any framebuffer of the XR layer is bound. */
  update(time: number) {
    this.uniforms.uTime.value = time;
    this.updateRippleProjection(time);

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);

    renderer.autoClear = autoClear;
    renderer.setClearColor(clearColor, clearAlpha);
  }

  get texture(): Texture {
    return this.target.texture;
  }
}
