import { AdditiveBlending, BackSide, CylinderGeometry, Mesh, ShaderMaterial, Vector2 } from 'three';
import { CausticField, WATER_HEIGHT, causticCommonGLSL, causticSunGLSL } from './CausticField';
import { PLINTH_RADIUS, PLINTH_TOP, TERRACE_COUNT, TERRACE_RISE, TERRACE_START, TERRACE_WIDTH } from './Rotunda';
import { WATER_DEFAULTS } from './Water';

/** The scattering volume is a closed cylinder around the room; fog hides everything beyond it. */
const VOLUME_RADIUS = 15;
const MAX_DISTANCE = 26;
const STEPS = 6;

/**
 * Volumetric sun beams (the original's post-process "light shafts") without a depth pass or a
 * render target. A closed cylinder around the pool is drawn additively from the inside, and every
 * pixel ray-marches the water between the eye and the first obstacle. At each step the sun that
 * arrives is read from the caustic map, along the refracted ray of the point sun, so the beams carry
 * the same bright filaments as the floor and drift with the waves. Sunlight is attenuated by the
 * water above the sample, blocked in the shadow of the columns, and the march stops at a column,
 * the stepped floor or the plinth. A Gaussian column of extra light stands under the sun opening.
 * The map is sampled blurred (mip bias), which keeps the few steps free of visible stepping noise.
 */
export class LightShafts {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(field: CausticField, aperture: Vector2) {
    const geometry = new CylinderGeometry(VOLUME_RADIUS, VOLUME_RADIUS, WATER_HEIGHT, 32, 1, false);
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: field.uniforms.uTime,
        uWaveAmp: field.uniforms.uWaveAmp,
        uRipples: field.uniforms.uRipples,
        uCausticMap: field.uniforms.uCausticMap,
        uSunColor: field.uniforms.uSunColor,
        uColor: { value: WATER_DEFAULTS.openingColor },
        uAperture: { value: aperture },
        uWidth: { value: WATER_DEFAULTS.openingWidth },
        uIntensity: { value: 1 },
      },
      side: BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${causticCommonGLSL}
        ${causticSunGLSL}
        uniform sampler2D uCausticMap;
        uniform vec3 uSunColor;
        uniform vec3 uColor;
        uniform vec2 uAperture;
        uniform float uWidth;
        uniform float uIntensity;
        varying vec3 vWorld;

        #define STEPS ${STEPS}
        #define VOLUME_R ${VOLUME_RADIUS.toFixed(2)}
        #define MAX_DIST ${MAX_DISTANCE.toFixed(2)}
        // Water absorption (red goes first), the same spectrum as the surface shader.
        #define SIGMA vec3(0.30, 0.075, 0.045)
        #define VIEW_SIGMA vec3(0.20, 0.05, 0.03)
        #define PHASE_G 0.55
        #define PLINTH_R ${PLINTH_RADIUS.toFixed(3)}
        #define PLINTH_TOP ${PLINTH_TOP.toFixed(3)}
        #define TERRACE_START ${TERRACE_START.toFixed(3)}
        #define TERRACE_WIDTH ${TERRACE_WIDTH.toFixed(5)}
        #define TERRACE_RISE ${TERRACE_RISE.toFixed(4)}
        #define TERRACE_COUNT ${TERRACE_COUNT.toFixed(1)}

        // Height of the stepped floor at radius r (the same profile as the geometry).
        float floorAt(float r) {
          if (r < PLINTH_R) return PLINTH_TOP;
          if (r < 3.55) return 0.2;
          if (r < 3.8) return 0.12;
          if (r < 4.05) return 0.06;
          if (r < TERRACE_START) return 0.0;
          return TERRACE_RISE * min(TERRACE_COUNT, 1.0 + floor((r - TERRACE_START) / TERRACE_WIDTH));
        }

        float interleavedNoise(vec2 p) {
          return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
        }

        float henyeyGreenstein(float c) {
          float g2 = PHASE_G * PHASE_G;
          return (1.0 - g2) / pow(1.0 + g2 - 2.0 * PHASE_G * c, 1.5);
        }

        void main() {
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);

          // Clip the ray to the cylinder and to the slab between the floor and the surface.
          float a = dot(rd.xz, rd.xz);
          float b = dot(ro.xz, rd.xz);
          float c = dot(ro.xz, ro.xz) - VOLUME_R * VOLUME_R;
          float disc = b * b - a * c;
          float tFar = MAX_DIST;
          float tNear = 0.0;
          if (a > 1e-6 && disc > 0.0) {
            float s = sqrt(disc);
            tNear = max(tNear, (-b - s) / a);
            tFar = min(tFar, (-b + s) / a);
          }
          if (abs(rd.y) > 1e-5) {
            float t0 = (0.0 - ro.y) / rd.y;
            float t1 = (WATER_HEIGHT - ro.y) / rd.y;
            tNear = max(tNear, min(t0, t1));
            tFar = min(tFar, max(t0, t1));
          } else if (ro.y < 0.0 || ro.y > WATER_HEIGHT) {
            tFar = -1.0;
          }
          if (tFar <= tNear) {
            gl_FragColor = vec4(0.0);
            return;
          }

          float dt = (tFar - tNear) / float(STEPS);
          float t = tNear + dt * interleavedNoise(gl_FragCoord.xy);
          vec3 sum = vec3(0.0);
          for (int i = 0; i < STEPS; i++) {
            vec3 p = ro + rd * t;
            // Stone ends the ray: the floor, the plinth and the columns hide the water behind them.
            if (p.y < floorAt(length(p.xz)) || insideColumn(p)) break;

            vec3 ray = sunRay(p);
            vec3 L = -ray;
            float shadow = columnShadow(p, L, vec2(0.0));

            // Sun that reaches this point: caustic filaments, absorbed by the water above it.
            vec2 q = p.xz - ray.xz / ray.y * p.y;
            vec3 irradiance = texture2D(uCausticMap, vec2(q.x / WAVE_TILE + 0.5, -q.y / WAVE_TILE + 0.5), 2.5).rgb / 0.22;
            // Mild contrast: a few soft rays instead of a forest of filaments (and no costly pow).
            irradiance *= irradiance;
            vec3 sun = exp(-SIGMA * (WATER_HEIGHT - p.y) / max(L.y, 0.4)) * irradiance * shadow;

            // The beam under the sun opening is a brighter column; the rest is a gentler glow.
            vec2 axis = uAperture + ray.xz / (-ray.y) * (WATER_HEIGHT - p.y);
            vec2 off = (p.xz - axis) / uWidth;
            float beam = exp(-1.6 * dot(off, off));
            float density = 0.03 + 1.3 * beam;

            float phase = henyeyGreenstein(dot(rd, L)) * 0.5;
            vec3 transmittance = exp(-VIEW_SIGMA * t);
            sum += sun * transmittance * phase * density;
            t += dt;
          }
          sum *= dt * 0.04 * uIntensity;
          sum *= uSunColor * 0.5 + uColor * 0.5;
          gl_FragColor = vec4(sum, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'Light shafts';
    this.mesh.position.y = WATER_HEIGHT / 2;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
