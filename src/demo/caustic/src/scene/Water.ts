import {
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { CausticField, WATER_HEIGHT, causticCommonGLSL } from './CausticField';

const FOG_COLOR = new Color('#295661');

export const WATER_DEFAULTS = {
  fogColor: FOG_COLOR,
  /** Fog colour as displayed (sRGB values), for blending after tone mapping and output conversion. */
  fogDisplay: (() => {
    const c = { r: 0, g: 0, b: 0 };
    FOG_COLOR.getRGB(c, SRGBColorSpace);
    return new Vector3(c.r, c.g, c.b);
  })(),
  openingColor: new Color('#65ddeb'),
  openingWidth: 4,
  haze: 1.0,
};

/** Where the refracted sun axis meets the still water (the bright Snell window). */
export function apertureOf(sunDirection: Vector3, lightHeight = 8.5): Vector2 {
  const rise = (lightHeight - WATER_HEIGHT) / sunDirection.y;
  return new Vector2(-sunDirection.x * rise, -sunDirection.z * rise);
}

/**
 * Underwater view of the water surface: Fresnel mix of the refracted sky (the Snell window and its
 * bright sun opening) and total internal reflection of the lit floor, found by reading the caustic
 * map where the reflected ray lands. There is no planar reflection pass.
 */
export class WaterSurface {
  readonly mesh: Mesh;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;

  constructor(field: CausticField, aperture: Vector2) {
    this.geometry = new PlaneGeometry(120, 120, 160, 160);
    this.geometry.rotateX(Math.PI / 2);
    // Dense near the installation, spreading into open water beyond the fog.
    const points = this.geometry.getAttribute('position');
    for (let i = 0; i < points.count; i++) {
      for (const axis of [0, 2]) {
        const x = points.array[i * 3 + axis] as number;
        (points.array as Float32Array)[i * 3 + axis] = Math.sign(x) * Math.pow(Math.abs(x) / 60, 1.7) * 60;
      }
    }

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: field.uniforms.uTime,
        uWaveAmp: field.uniforms.uWaveAmp,
        uRipples: field.uniforms.uRipples,
        uCausticMap: field.uniforms.uCausticMap,
        uHaze: { value: WATER_DEFAULTS.haze },
        uOpenWidth: { value: WATER_DEFAULTS.openingWidth },
        uOpenColor: { value: WATER_DEFAULTS.openingColor },
        uAperture: { value: aperture },
        uDistant: { value: WATER_DEFAULTS.fogDisplay },
      },
      side: DoubleSide,
      vertexShader: /* glsl */ `
        ${causticCommonGLSL}
        varying vec3 vWorld;
        varying vec2 vXZ;
        void main() {
          vXZ = position.xz;
          vec3 w = allWaves(position.xz);
          vec3 wp = vec3(position.x, WATER_HEIGHT + w.z, position.z);
          vWorld = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${causticCommonGLSL}
        uniform sampler2D uCausticMap;
        uniform float uHaze;
        uniform float uOpenWidth;
        uniform vec3 uOpenColor;
        uniform vec2 uAperture;
        uniform vec3 uDistant;
        varying vec3 vWorld;
        varying vec2 vXZ;
        void main() {
          vec3 wave = allWaves(vXZ);
          vec3 normal = normalize(vec3(wave.x, -1.0, wave.y));
          vec3 p = vWorld;
          vec3 incident = normalize(p - cameraPosition);
          float cosine = clamp(dot(-incident, normal), 0.0001, 1.0);
          float sinSquared = (1.0 - cosine * cosine) * 1.333 * 1.333;
          float transmittedCosine = sqrt(max(1.0 - sinSquared, 0.0));
          float rs = pow((cosine * 1.333 - transmittedCosine) / (cosine * 1.333 + transmittedCosine), 2.0);
          float rp = pow((transmittedCosine * 1.333 - cosine) / max(transmittedCosine * 1.333 + cosine, 0.0001), 2.0);
          float fresnel = sinSquared >= 1.0 ? 1.0 : (rs + rp) * 0.5;

          vec3 ray = reflect(incident, normal);
          ray.y = min(ray.y, -0.015);
          ray = normalize(ray);
          float dist = -p.y / ray.y;
          vec3 hit = p + ray * max(dist, 0.01);
          vec3 irradiance = texture2D(uCausticMap, vec2(hit.x / WAVE_TILE + 0.5, -hit.z / WAVE_TILE + 0.5)).rgb / 0.22;
          vec3 floorColor = vec3(0.30, 0.27, 0.22) * (0.1 + 0.3 * irradiance);
          vec3 extinction = exp(-vec3(0.48, 0.12, 0.075) * clamp(dist, 0.0, 25.0) * uHaze);
          vec3 underwater = floorColor * extinction + vec3(0.005, 0.105, 0.17) * (1.0 - extinction);

          vec3 skyDirection = refract(incident, normal, 1.333);
          vec3 sky = mix(vec3(0.005, 0.12, 0.19), vec3(0.03, 0.45, 0.62), pow(max(skyDirection.y, 0.0), 2.0));
          vec2 apertureOffset = (p.xz - uAperture + wave.xy * 0.7) / uOpenWidth;
          float aperture = exp(-1.6 * dot(apertureOffset, apertureOffset));
          float fade = smoothstep(18.0, 45.0, length(p - cameraPosition));

          vec3 color = sky * (1.0 - fresnel) + underwater * fresnel
            + vec3(10.24, 9.6, 7.68) * pow(aperture, 8.0)
            + uOpenColor * 1.12 * aperture;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uDistant, fade);
        }
      `,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'Water surface';
    this.mesh.frustumCulled = false;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
