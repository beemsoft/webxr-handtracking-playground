import * as THREE from 'three';
import { generateStageGLSL, BREAKER_COMMON_GLSL, SHORE_COMMON_GLSL, BreakerEvent } from './BreakerWave';

// One continuous water mesh from the swash zone to the horizon: dense rows across the breaker
// zone, geometrically growing rows offshore and columns fanning out with distance so the
// on-screen vertex density stays roughly constant (ported from ShoreBreak's WaterSurface).
function buildGeometry(): THREE.BufferGeometry {
  // Row budget is spent where the breaking faces are (events land at z ~ -1.75..-2.0, the crest
  // stands up over z ~ -5..0): 6 cm rows there (ShoreBreak uses 0.9 cm, but it also only draws a
  // few metres of beach), 18 cm across the rest of the surf zone, 30 cm over the swash sand.
  const rows: number[] = [];
  let z = 8.0;
  while (z > 1.6) { rows.push(z); z -= 0.3; }
  while (z > -5.6) { rows.push(z); z -= 0.06; }
  while (z > -12.0) { rows.push(z); z -= 0.18; }
  let s = 0.18;
  while (z > -900.0) { rows.push(z); s = Math.min(s * 1.13, 60.0); z -= s; }
  rows.push(-900.0);

  const nc = 97;
  const nr = rows.length;
  const pos = new Float32Array(nr * nc * 3);
  let k = 0;
  for (let j = 0; j < nr; j++) {
    const zr = rows[j];
    const hw = 34.0 + 1.35 * Math.max(-zr - 6.0, 0.0);
    for (let i = 0; i < nc; i++) {
      const sx = (i / (nc - 1)) * 2.0 - 1.0;
      // Denser columns near the centre where the camera stands
      const x = hw * Math.sign(sx) * (Math.abs(sx) + 0.6 * Math.pow(Math.abs(sx), 3)) / 1.6;
      pos[k * 3] = x;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = zr;
      k++;
    }
  }

  const idx = new Uint32Array((nr - 1) * (nc - 1) * 6);
  let t = 0;
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -400), 1500);
  return g;
}

export class RollingWaterSurface extends THREE.Mesh {
  private customMaterial: THREE.ShaderMaterial;

  constructor() {
    const geometry = buildGeometry();
    const stageGLSL = generateStageGLSL();

    const material = new THREE.ShaderMaterial({
      name: 'RollingWaterSurfaceMaterial',
      side: THREE.DoubleSide,
      transparent: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff2dc) },
        uDeepColor: { value: new THREE.Color(0.006, 0.13, 0.16) },
        uTurbidColor: { value: new THREE.Color(0.03, 0.27, 0.29) },
        uWaterAtten: { value: new THREE.Vector3(0.42, 0.075, 0.07) },
        uBedColor: { value: new THREE.Color(0.58, 0.54, 0.44) },
        uFoamColor: { value: new THREE.Color(0.86, 0.9, 0.9) },
        uGlowColor: { value: new THREE.Color(0.2, 0.5, 0.47) },
        uHorizonColor: { value: new THREE.Color(0.55, 0.72, 0.9) },
        uZenithColor: { value: new THREE.Color(0.12, 0.3, 0.65) },
        uEvtCount: { value: 8 },
        uEvtA: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtB: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtC: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtD: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
        uEvtE: { value: new Array(8).fill(0).map(() => new THREE.Vector4()) },
      },
      vertexShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vFoam;
        varying vec2 vXZ0;
        varying float vCrest;

        uniform float uTime;
        ${SHORE_COMMON_GLSL}
        ${stageGLSL}
        ${BREAKER_COMMON_GLSL}

        // Background swell: three shoaling Gerstner-like components. The amplitude grows a little
        // as the water shallows (Green's law) and dies out where the breakers take over.
        float swellHeight(vec2 p, float t) {
          float depth = max(0.0 - bedProfile(p.y), 0.05);
          float shoal = clamp(pow(3.5 / depth, 0.25), 0.8, 1.6) * smoothstep(0.25, 1.2, depth);
          float k1 = 0.22, w1 = sqrt(9.81 * k1);
          float k2 = 0.5, w2 = sqrt(9.81 * k2);
          float k3 = 1.1, w3 = sqrt(9.81 * k3);
          // crests run almost parallel to the shoreline so the swell marches straight onto the beach
          float ph1 = k1 * (p.y * 0.995 + p.x * 0.03) - w1 * t;
          float ph2 = k2 * (p.y * 0.99 - p.x * 0.08) - w2 * t;
          float ph3 = k3 * (p.y * 0.96 + p.x * 0.2) - w3 * t;
          // peaked crests (cos^2 shape) read as swell rather than sine ripples
          float s1 = pow(0.5 + 0.5 * sin(ph1), 1.6) - 0.4;
          return shoal * (0.17 * s1 + 0.06 * sin(ph2) + 0.02 * sin(ph3));
        }

        float surfaceHeight(vec2 xz, float t, out vec3 disp, out vec3 foam) {
          float y = swellHeight(xz, t);
          y += brkElevation(vec3(xz.x, 0.0, xz.y), t, disp, foam);
          return y;
        }

        void main() {
          vec2 xz = position.xz;
          vXZ0 = xz;
          vec3 disp = vec3(0.0), foam = vec3(0.0);
          float y = surfaceHeight(xz, uTime, disp, foam);

          vec3 n = vec3(0.0, 1.0, 0.0);
          if (xz.y > -20.0) {
            // finite-difference macro normal (only across the break zone; the far sea is shaded per pixel);
            // one step everywhere (a 5 cm / 10 cm switch at the dense-row boundaries left a visible
            // shading seam across the water at the break line)
            float eps = 0.06;
            vec3 dA, dB; vec3 fA, fB;
            float yX = surfaceHeight(xz + vec2(eps, 0.0), uTime, dA, fA);
            float yZ = surfaceHeight(xz + vec2(0.0, eps), uTime, dB, fB);
            n = normalize(vec3((y - yX) / eps, 1.0, (y - yZ) / eps));
          }

          vec3 p = vec3(xz.x + disp.x, y + disp.y, xz.y + disp.z);
          vFoam = foam;
          // crest proximity from the macro slope: the steep hollow face is the thin, backlit part
          vCrest = clamp((1.0 - n.y) * 1.6 + length(disp) * 2.0, 0.0, 1.0);
          vNormal = n;

          vec4 worldPos = modelMatrix * vec4(p, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vFoam;
        varying vec2 vXZ0;
        varying float vCrest;

        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uDeepColor;
        uniform vec3 uTurbidColor;
        uniform vec3 uWaterAtten;
        uniform vec3 uBedColor;
        uniform vec3 uFoamColor;
        uniform vec3 uGlowColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uZenithColor;

        ${SHORE_COMMON_GLSL}

        // Wind ripple / chop slopes: a few octaves of derivative noise, faded with distance so the
        // far sea does not alias into sparkle.
        vec2 rippleGrad(vec2 p, float t, float dist) {
          vec2 g = vec2(0.0);
          vec2 wind = vec2(0.35, 1.0);
          float L = 2.2, a = 0.11;
          for (int i = 0; i < 3; i++) {
            float keep = 1.0 - smoothstep(L * 40.0, L * 160.0, dist);
            if (keep > 0.0) {
              vec3 n = vnoised(p / L + wind * t * (0.35 / L) + float(i) * 17.3);
              g += n.yz * (a / L) * keep;
            }
            L *= 0.42; a *= 0.55;
          }
          return g;
        }

        vec3 skyRadiance(vec3 R, vec3 L) {
          float up = clamp(R.y, 0.0, 1.0);
          vec3 sky = mix(uHorizonColor, uZenithColor, pow(up, 0.55));
          float sunHalo = pow(max(dot(R, L), 0.0), 12.0);
          return sky + uSunColor * sunHalo * 0.35;
        }

        void main() {
          vec3 P = vWorldPosition;
          float bed = bedHeight(P.xz);
          float depth = P.y - bed;
          // shoreline / swash edge (sub-centimetre films drain into the sand)
          float edgeN = vnoise(P.xz * 23.0) * 0.004 + vnoise(P.xz * 5.0) * 0.004;
          if (depth < 0.003 + edgeN) discard;

          vec3 toCam = cameraPosition - P;
          float dist = length(toCam);
          vec3 V = toCam / dist;
          vec3 L = normalize(uSunDirection);

          float fresh = clamp(vFoam.x, 0.0, 1.0);
          float aged = clamp(vFoam.y, 0.0, 1.0);
          float film = clamp(vFoam.z, 0.0, 1.0) * (1.0 - smoothstep(0.03, 0.12, depth));

          // ---- normals: macro (vertex) + ripples (per pixel) ----
          vec3 N = normalize(vNormal);
          float rippleStrength = mix(0.6, 1.0, smoothstep(0.0, 0.6, depth)) * (1.0 - 0.7 * fresh);
          vec2 g = rippleGrad(P.xz, uTime, dist) * rippleStrength;
          // the foam blanket is rough, the glassy face is smooth
          N = normalize(N - vec3(g.x, 0.0, g.y) * smoothstep(0.3, 0.8, N.y));
          if (!gl_FrontFacing) N = -N;

          float NdotL = max(dot(N, L), 0.0);
          float NdotV = max(dot(N, V), 0.0);

          // ---- optics: Beer-Lambert through the water column over the sand bed ----
          float path = min(depth / max(V.y, 0.06), 40.0);
          vec3 trans = exp(-uWaterAtten * path);
          // caustic light dancing on the shallow bed
          float caust = 0.0;
          if (depth < 1.6 && dist < 60.0) {
            caust = vnoise(P.xz * 3.0 + vec2(uTime * 0.6, -uTime * 0.4)) * vnoise(P.xz * 4.3 - vec2(uTime * 0.5, uTime * 0.3));
            caust = smoothstep(0.1, 0.5, caust) * (1.0 - smoothstep(0.1, 1.6, depth));
          }
          vec3 bedLit = uBedColor * (0.45 + 0.75 * max(L.y, 0.0)) * (1.0 + 0.6 * caust);
          // turbidity: stirred sediment and bubbles behind the bore and in the break zone trough
          float turbid = clamp(aged * 1.2 + fresh * 0.6, 0.0, 1.0) * smoothstep(0.05, 0.4, depth);
          vec3 upwelling = mix(uDeepColor, uTurbidColor, turbid);
          vec3 body = mix(upwelling, bedLit, trans * (1.0 - 0.75 * turbid));
          // thin swash film: a milky sheen over the wet sand
          body = mix(body, mix(bedLit, vec3(0.6, 0.62, 0.6), 0.35), film * 0.7);

          // ---- reflection ----
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);
          vec3 sky = skyRadiance(R, L);
          float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
          F = mix(F, F * 0.45, film);   // the swash film is grey-neutral, not a blue mirror

          vec3 H = normalize(L + V);
          float NdotH = max(dot(N, H), 0.0);
          float spec = pow(NdotH, 900.0) * 6.0 + pow(NdotH, 80.0) * 0.25;
          spec *= smoothstep(0.0, 0.08, L.y);

          vec3 col = mix(body, sky, F) + uSunColor * spec * (1.0 - fresh);

          // ---- backlit crest glow: thin sunlit water of a standing / throwing face ----
          float faceToward = smoothstep(0.08, 0.45, N.z);
          float thin = smoothstep(0.08, 0.5, P.y) * (1.0 - smoothstep(0.5, 1.6, depth) * 0.6);
          float back = 0.35 + 0.65 * pow(max(dot(V, -L), 0.0), 2.0);
          float glow = thin * faceToward * back * (1.0 - fresh * 0.6) * (0.5 + 0.5 * vCrest + 0.5 * NdotL);
          col += uGlowColor * glow * 1.4;

          // ---- foam: fresh whitewater and an aging lace network drifting with the flow ----
          vec2 flow = vec2(0.0, uTime * 0.25);
          float lace = fbm(P.xz * 2.6 + flow);
          float bubbles = vnoise(P.xz * 19.0 - flow * 3.0);
          float laceMask = smoothstep(0.42 - aged * 0.25, 0.68 - aged * 0.2, lace);
          float foamAmt = clamp(fresh * (0.75 + 0.5 * bubbles) + aged * laceMask * 0.95, 0.0, 1.0);
          foamAmt *= smoothstep(0.002, 0.02, depth);
          // foam shading: bubble-cluster occlusion in the lace holes, a sunlit rim on the whitewater
          // front and a cool sky tint in the shadowed troughs between clumps
          float occl = mix(1.0, 0.55 + 0.45 * smoothstep(0.3, 0.75, lace), aged * (1.0 - fresh));
          float rim = pow(1.0 - NdotV, 2.0) * 0.35 * fresh;
          vec3 foamCol = uFoamColor * (0.45 + 0.6 * NdotL) * (0.85 + 0.3 * bubbles) * occl;
          foamCol = mix(foamCol, uHorizonColor * 0.9, 0.25 * (1.0 - NdotL) * (1.0 - fresh));
          foamCol += uSunColor * rim * smoothstep(0.0, 0.08, L.y);
          col = mix(col, foamCol, foamAmt);
          // fine spray mist hanging over the active crest line
          col += uFoamColor * 0.12 * fresh * vCrest * (0.5 + 0.5 * bubbles);

          // ---- aerial perspective toward the horizon ----
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
    this.name = 'RollingWaterSurface';
    this.frustumCulled = false;
  }

  public updateUniforms(time: number, events: BreakerEvent[]) {
    this.customMaterial.uniforms.uTime.value = time;
    this.customMaterial.uniforms.uEvtCount.value = Math.min(events.length, 8);

    for (let i = 0; i < Math.min(events.length, 8); i++) {
      const e = events[i];
      (this.customMaterial.uniforms.uEvtA.value[i] as THREE.Vector4).set(e.t0, e.H, e.zI, e.seed);
      (this.customMaterial.uniforms.uEvtB.value[i] as THREE.Vector4).set(e.c, e.x0, e.wobble, e.strength);
      (this.customMaterial.uniforms.uEvtC.value[i] as THREE.Vector4).set(e.kappa, e.waviness, e.hvar, e.style);
      // Along-shore timing: no local V-peel about x0 (that zippered the splash sideways), but the
      // smooth multi-nucleation far modulation (amplitude e.far s, phase e.farPhase) so the crest
      // breaks in diagonal sections 10-25 m apart like the original.
      (this.customMaterial.uniforms.uEvtD.value[i] as THREE.Vector4).set(e.far ?? 0.0, e.farPhase, 0.0, 0.0);
      (this.customMaterial.uniforms.uEvtE.value[i] as THREE.Vector4).set(0.0, 0.75, 1.35, e.tilt * 0.3);
    }
  }
}
