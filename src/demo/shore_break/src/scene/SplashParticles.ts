import * as THREE from 'three';
import { generateStageGLSL, BREAKER_COMMON_GLSL, SHORE_COMMON_GLSL, BreakerEvent } from './BreakerWave';

// Impact splash-up of the plunging lip as a single GPU point cloud (one draw call, no CPU
// simulation, no render targets). ShoreBreak's Whitewater.js drives ~15 emitter kinds through
// ring buffers and a thickness pass; here every particle is fully analytic: its launch time is
// the local lip impact time (shared brkTiming) plus a per-particle delay, and its position is a
// ballistic arc from the landing line evaluated in the vertex shader. The original's along-shore
// structure is kept: cauliflower domes every ~2.25 m (alternating strong / weak, saddles between),
// the first launches the fastest with later ones filling the body below, crown droplets that
// tear into spray, and a plunge-style gate (spilling breakers barely dome).
export class SplashParticles extends THREE.Points {
  private customMaterial: THREE.ShaderMaterial;

  constructor(count = 4096) {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 4);
    const rnd2 = new Float32Array(count * 2);

    // deterministic LCG so the cloud is identical on every run
    let s = 1234567;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      // along-shore slot: denser near the viewer (x = 0), thinning out towards +-20 m
      const u = rand() * 2.0 - 1.0;
      const x = Math.sign(u) * Math.pow(Math.abs(u), 1.35) * 20.0;
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      rnd[i * 4] = rand();
      rnd[i * 4 + 1] = rand();
      rnd[i * 4 + 2] = rand();
      rnd[i * 4 + 3] = rand();
      rnd2[i * 2] = rand();
      rnd2[i * 2 + 1] = rand();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    geometry.setAttribute('aRand2', new THREE.BufferAttribute(rnd2, 2));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100);

    const stageGLSL = generateStageGLSL();

    const material = new THREE.ShaderMaterial({
      name: 'SplashParticlesMaterial',
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPointScale: { value: 1000.0 },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff2dc) },
        uFoamColor: { value: new THREE.Color(0.9, 0.93, 0.93) },
        uHorizonColor: { value: new THREE.Color(0.55, 0.72, 0.9) },
        uEvtCount: { value: 8 },
        uEvtA: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtB: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtC: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtD: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtE: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
      },
      vertexShader: `
        precision highp float;
        attribute vec4 aRand;
        attribute vec2 aRand2;

        varying float vAlpha;
        varying float vLife;     // 0 launch .. 1 end of life
        varying float vKind;     // 0 dome blob .. 1 crown droplet / spray
        varying float vSeed;
        varying vec3 vWorldPosition;

        uniform float uTime;
        uniform float uPointScale;
        ${stageGLSL}
        ${BREAKER_COMMON_GLSL}

        #define G_ACC 9.81
        #define DOME_SPACING 2.25

        float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

        // ShoreBreak domeField: splash domes every ~2.25 m along the crest, alternating strong /
        // weak, with low saddles between them (the phase follows the event seed)
        float domeField(float x, float seed) {
          float ph = DOME_SPACING * fract(seed * 3.7) - 2.8273;
          float k0 = floor((x - ph) / DOME_SPACING + 0.5);
          float a = 0.0;
          for (int j = -1; j <= 1; j++) {
            float k = k0 + float(j);
            float c = ph + k * DOME_SPACING + 0.2 * (hash11(k * 7.13 + seed * 91.7) - 0.5);
            float even = step(0.5, 1.0 - abs(mod(k, 2.0)));
            float amp = mix(0.85, 1.0, even) * (0.92 + 0.16 * hash11(k * 3.71 + seed * 17.3));
            float sg = x < c ? mix(0.4, 0.3, even) : 0.6;
            a = max(a, amp * exp(-0.5 * pow((x - c) / sg, 2.0)));
          }
          return a;
        }

        void main() {
          float x = position.x;
          // a few particles per slot spread over the slot neighbourhood so the domes read as clusters
          x += (aRand.x - 0.5) * 0.9;

          float bestAlpha = 0.0;
          vec3 finalPos = vec3(x, -100.0, 0.0);
          float life = 0.0, kind = 0.0, seedOut = 0.0;

          // per-particle launch parameters
          float delay = 0.03 + 0.5 * aRand.y * aRand.y;         // the first launches are the fastest
          float isDrop = step(0.72, aRand.z);                   // ~28 % crown droplets / spray
          float lifeT = mix(0.55, 0.95, aRand.w) + 0.35 * isDrop;

          for (int k = 0; k < MAX_EVENTS; k++) {
            if (k >= uEvtCount) break;
            if (uEvtB[k].w <= 0.01) continue;

            float H, zI;
            float ti = brkTiming(k, x, H, zI);
            float tau = uTime - ti - delay;
            if (tau < 0.0 || tau > lifeT) continue;

            float seed = uEvtA[k].w;
            float style = uEvtC[k].w;
            float strength = uEvtB[k].w;
            float scale = H / 0.45;

            // only a plunging lip throws a splash-up (spilling / collapsing breakers barely dome)
            float plunge = smoothstep(0.35, 0.75, style);
            float dome = domeField(x, seed);
            // per-particle dome gate: weak sections / saddles launch fewer particles
            float gate = plunge * strength * step(aRand2.x * 0.9, dome * dome);
            if (gate <= 0.01) continue;

            // launch point: the landing line, a little shoreward where the lip slams the trough
            float zL = brkLandZ(zI, scale) + 0.1 + 0.3 * aRand2.y;
            float yL = 0.05 * scale;

            // cauliflower splash-up (h = V^2 / 2g): dome top ~2.8-3.9 m/s for a 0.45 m wave,
            // later launches lower, crown drops a touch faster and more scattered
            float en = sqrt(scale);
            float Wtop = mix(2.8, 3.95, dome) * en;
            float W = Wtop * (1.0 - 0.55 * (delay / 0.53)) * mix(0.75, 1.0, aRand2.x) * (1.0 + 0.25 * isDrop);
            // thrown shoreward with the lip's momentum, a little along-shore scatter
            float vz = (0.9 + 1.3 * aRand.w) * en * plunge;
            float vx = (aRand.x - 0.5) * (0.6 + 0.9 * isDrop);

            vec3 p = vec3(x + vx * tau, yL + W * tau - 0.5 * G_ACC * tau * tau, zL + vz * tau);
            // the aerated body is slowed by its own drag: it sags rather than falling freely
            p.y += (1.0 - isDrop) * 0.12 * G_ACC * tau * tau * smoothstep(0.0, 0.6, tau);
            if (p.y < yL - 0.05) continue;   // fallen back into the roller

            float a = gate * (1.0 - smoothstep(0.6, 1.0, tau / lifeT));
            // distance fade: fine spray is invisible far away
            float dist = distance(cameraPosition, p);
            a *= 1.0 - smoothstep(25.0, 60.0, dist) * 0.6;

            if (a > bestAlpha) {
              bestAlpha = a;
              finalPos = p;
              life = tau / lifeT;
              kind = isDrop;
              seedOut = seed;
            }
          }

          vAlpha = bestAlpha;
          vLife = life;
          vKind = kind;
          vSeed = seedOut + aRand.z * 7.0;

          vec4 worldPos = modelMatrix * vec4(finalPos, 1.0);
          vWorldPosition = worldPos.xyz;
          vec4 mvPos = viewMatrix * worldPos;
          gl_Position = projectionMatrix * mvPos;

          // blobs swell from ~12 cm to ~40 cm as the dome fragments; drops stay small
          float sizeM = mix(mix(0.12, 0.42, smoothstep(0.0, 0.7, life)), mix(0.05, 0.12, life), kind);
          float ps = sizeM * uPointScale / max(-mvPos.z, 0.1);
          gl_PointSize = bestAlpha > 0.01 ? clamp(ps, 1.0, 96.0) : 0.0;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying float vAlpha;
        varying float vLife;
        varying float vKind;
        varying float vSeed;
        varying vec3 vWorldPosition;

        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uFoamColor;
        uniform vec3 uHorizonColor;

        ${SHORE_COMMON_GLSL}

        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(q, q);
          if (r2 > 1.0) discard;

          // bubbly cluster rather than a smooth ball: the blob is eaten away by noise as it ages
          float n = vnoise(q * 2.6 + vSeed * 13.0 + vec2(0.0, vLife * 1.5));
          float edge = mix(0.55, 0.15, vLife) + 0.45 * (n - 0.5);
          float body = smoothstep(1.0, edge, r2);
          // crown droplets: a crisp little bead
          float bead = smoothstep(1.0, 0.35, r2);
          float shape = mix(body, bead, vKind);
          if (shape <= 0.02) discard;

          // sphere-ish shading: lit side towards the sun, cool sky in the shadow
          vec3 N = normalize(vec3(q.x, -q.y, sqrt(max(1.0 - r2, 0.0))));
          vec3 L = normalize(uSunDirection);
          float ndl = 0.5 + 0.5 * dot(N, vec3(L.x, L.y, -L.z));
          vec3 col = uFoamColor * (0.55 + 0.6 * ndl) * uSunColor;
          col = mix(uHorizonColor * 0.9, col, 0.35 + 0.65 * ndl);
          // the aerated dome is slightly green-grey where it is thick; spray is pure white
          col = mix(col * vec3(0.9, 0.97, 0.95), col, vKind + 0.5 * vLife);

          float alpha = vAlpha * shape * mix(0.85, 0.7, vKind);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });

    super(geometry, material);
    this.customMaterial = material;
    this.name = 'SplashParticles';
    this.frustumCulled = false;
    this.renderOrder = 10; // after the water and the lip (both depthWrite off / transparent)
  }

  // viewportHeight in pixels: gl_PointSize must scale with the framebuffer, not the canvas
  public updateUniforms(time: number, events: BreakerEvent[], viewportHeight?: number) {
    this.customMaterial.uniforms.uTime.value = time;
    if (viewportHeight && viewportHeight > 0) {
      // point size (px) = size (m) * viewportHeight / (2 * tan(fov/2)) / depth; ~0.9 covers 60-100 deg FOV
      this.customMaterial.uniforms.uPointScale.value = viewportHeight * 0.9;
    }
    this.customMaterial.uniforms.uEvtCount.value = Math.min(events.length, 8);

    for (let i = 0; i < Math.min(events.length, 8); i++) {
      const e = events[i];
      // Must match RollingWaterSurface / LipRibbon packing so the splash lands where the lip lands
      (this.customMaterial.uniforms.uEvtA.value[i] as THREE.Vector4).set(e.t0, e.H, e.zI, e.seed);
      (this.customMaterial.uniforms.uEvtB.value[i] as THREE.Vector4).set(e.c, e.x0, e.wobble, e.strength);
      (this.customMaterial.uniforms.uEvtC.value[i] as THREE.Vector4).set(e.kappa, e.waviness, e.hvar, e.style);
      (this.customMaterial.uniforms.uEvtD.value[i] as THREE.Vector4).set(e.far ?? 0.0, e.farPhase, 0.0, 0.0);
      (this.customMaterial.uniforms.uEvtE.value[i] as THREE.Vector4).set(0.0, 0.75, 1.35, e.tilt * 0.3);
    }
  }
}
