import * as THREE from 'three';
import { generateStageGLSL, BREAKER_COMMON_GLSL, SHORE_COMMON_GLSL, BreakerEvent } from './BreakerWave';

// Dynamic plunging lip mesh representing the overturning curling jet (barrel) of breaking waves.
export class LipRibbon extends THREE.Mesh {
  private customMaterial: THREE.ShaderMaterial;

  constructor() {
    // Build ribbon geometry with segments around the barrel curl and along the shore
    const cols = 160; // Along-shore cross sections
    const rows = 32;  // Around the curl cross section (upper surface + underside)
    const width = 40; // Along shore extent (-20 to +20)

    const pos = new Float32Array((cols + 1) * (rows + 1) * 3);
    const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
    const indices: number[] = [];

    let pIdx = 0;
    let uvIdx = 0;

    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = (u - 0.5) * width;
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        pos[pIdx++] = x;
        pos[pIdx++] = 0; // displaced in vertex shader
        pos[pIdx++] = v;

        uvs[uvIdx++] = u;
        uvs[uvIdx++] = v;
      }
    }

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = (i + 1) * (rows + 1) + j;
        const c = i * (rows + 1) + (j + 1);
        const d = (i + 1) * (rows + 1) + (j + 1);

        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100);

    const stageGLSL = generateStageGLSL();

    const material = new THREE.ShaderMaterial({
      name: 'LipRibbonMaterial',
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff2dc) },
        uWaterColor: { value: new THREE.Color(0.03, 0.27, 0.29) },
        uGlowColor: { value: new THREE.Color(0.22, 0.52, 0.48) },
        uFoamColor: { value: new THREE.Color(0.86, 0.9, 0.9) },
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
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vFoam;
        varying float vArc;
        varying float vThick;

        uniform float uTime;
        ${stageGLSL}
        ${BREAKER_COMMON_GLSL}

        // ---- ShoreBreak lip (brkLip): the lip is a curved sheet whose centreline is a cubic
        // Bezier from the root R (just ahead of the apex, horizontal tangent) to the tip T. The tip
        // grows out of the steepening crest between TB and TE, then flies ballistically while the
        // apex collapses in place; after touch-down the curtain is absorbed into the trough.
        #define LIP_TB (-0.42)
        #define LIP_TE (-0.33)
        #define G_ACC 9.81

        void main() {
          vUv = uv;
          vec3 p = position;
          float x = p.x;
          float arc = p.z;
          // the ribbon wraps around the sheet: 0..0.5 upper surface root->tip, 0.5..1 underside tip->root
          float sg = arc < 0.5 ? arc * 2.0 : 2.0 - arc * 2.0;   // 0 root .. 1 tip
          float side = arc < 0.5 ? 1.0 : -1.0;
          
          float totalAlpha = 0.0;
          float totalFoam = 0.0;
          float totalThick = 1.0;
          vec3 finalPos = vec3(x, -100.0, 0.0); // Hidden if no active breaker
          vec3 finalNorm = vec3(0.0, 1.0, 0.0);

          for (int k = 0; k < MAX_EVENTS; k++) {
            if (k >= uEvtCount) break;
            if (uEvtB[k].w <= 0.01) continue;

            float H, zI;
            float ti = brkTiming(k, x, H, zI);
            float scale = H / 0.45;
            float rs = max(sqrt(scale), 0.1);
            float tn = (uTime - ti) / rs;
            float style = uEvtC[k].w;
            float seed = uEvtA[k].w;

            if (tn < LIP_TB || tn > 0.4) continue;

            BrkStage st = brkStage(tn);
            vec2 A = vec2(brkApexZ(zI, st.za, scale, rs, tn), st.ya * scale);   // apex (z, y)
            float grow = smoothstep(LIP_TB, LIP_TB + 0.06, tn);
            float wR = 0.075 * scale;
            // the root of the jet (where the barrel ceiling turns down into the wall) moves out
            // from inside the crest as the lip forms
            vec2 R = A + vec2(mix(0.02, 0.10, smoothstep(LIP_TB, LIP_TE + 0.05, tn)) * scale, -0.5 * wR);
            vec2 rel = vec2(0.17, -0.043) * scale;
            vec2 T, vT;
            float fl = 0.0;
            if (tn < LIP_TE) {
              float f = smoothstep(LIP_TB, LIP_TE, tn);
              T = A + mix(vec2(0.03, -0.06) * scale, rel, f);
              vT = vec2(1.5, -0.3) * rs;
            } else {
              BrkStage gE = brkStage(LIP_TE);
              vec2 Te = vec2(brkApexZ(zI, gE.za, scale, rs, LIP_TE), gE.ya * scale) + rel;
              // only a plunging crest throws its lip far; a spilling one dribbles it down the face
              vec2 V0 = vec2(1.05 * mix(0.55, 1.0, style), -0.10) * rs;
              fl = (tn - LIP_TE) * rs;
              float Tj = -LIP_TE * rs;              // the tip lands at tn = 0
              // the lip is thrown from a crest that is still gliding shoreward (brkDrift): carry
              // the crest's mean drift speed over the flight so the tip lands ahead of the root
              V0.x += (brkDrift(scale, 0.0) - brkDrift(scale, LIP_TE)) / Tj;
              float fb = min(fl, Tj);
              T = Te + V0 * fb + vec2(0.0, -0.5 * G_ACC * fb * fb);
              vT = V0 + vec2(0.0, -G_ACC * fb);
              if (fl > Tj) {
                float a = fl - Tj;
                T += vec2(V0.x * a * 0.6, -0.25 * scale * smoothstep(0.0, 0.25 * rs, a));
              }
            }
            // slow along-shore undulation of the throw (the lip never lands as a ruler line)
            T.x += 0.04 * scale * sin(x * 1.3 + seed * 20.0) * smoothstep(LIP_TE, 0.0, tn);

            vec2 ch = T - R;
            float len = max(length(ch), 1e-4);
            vec2 dT = normalize(ch / len + normalize(vT));
            vec2 P1 = R + vec2(0.45 * max(ch.x, 0.02 * scale) + 0.1 * len, 0.0);
            vec2 P2 = T - dT * 0.35 * len;
            float wT = 0.035 * scale * (1.0 - 0.5 * min(fl / 0.3, 1.0)) * grow;

            // centreline point and tangent at sg
            float u1 = 1.0 - sg;
            vec2 c = u1 * u1 * u1 * R + 3.0 * u1 * u1 * sg * P1 + 3.0 * u1 * sg * sg * P2 + sg * sg * sg * T;
            vec2 dc = 3.0 * u1 * u1 * (P1 - R) + 6.0 * u1 * sg * (P2 - P1) + 3.0 * sg * sg * (T - P2);
            vec2 tg = length(dc) > 1e-6 ? normalize(dc) : vec2(1.0, 0.0);
            vec2 nrm = vec2(-tg.y, tg.x);                    // "up" side of the sheet in (z, y)
            float width = wT + (wR - wT) * pow(1.0 - sg, 0.8);
            vec2 q = c + side * 0.5 * width * nrm;

            // visible from birth until the curtain has been absorbed by the trough
            float activeAlpha = grow * (1.0 - smoothstep(0.1, 0.4, tn)) * mix(0.55, 1.0, style);

            if (activeAlpha > totalAlpha) {
              totalAlpha = activeAlpha;
              totalThick = clamp(width / wR, 0.0, 1.0);
              finalPos = vec3(x, q.y, q.x);
              finalNorm = vec3(0.0, nrm.y, nrm.x) * side;
              // the rim whitens as the tip flies, and the whole sheet aerates after impact
              totalFoam = smoothstep(0.55, 1.0, sg) * smoothstep(LIP_TE, LIP_TE + 0.15, tn) + smoothstep(-0.05, 0.15, tn);
            }
          }

          vAlpha = totalAlpha;
          vFoam = clamp(totalFoam, 0.0, 1.0);
          vArc = sg;
          vThick = totalThick;
          vNormal = normalize(normalMatrix * finalNorm);
          
          vec4 worldPos = modelMatrix * vec4(finalPos, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vFoam;
        varying float vArc;
        varying float vThick;

        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uWaterColor;
        uniform vec3 uGlowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uHorizonColor;

        ${SHORE_COMMON_GLSL}

        void main() {
          if (vAlpha <= 0.01) discard;

          vec3 P = vWorldPosition;
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDirection);
          vec3 V = normalize(cameraPosition - P);
          if (dot(N, V) < 0.0) N = -N;

          // Streaks running down the jet and a ragged, spray-torn tip
          float streak = vnoise(vec2(P.x * 6.0, vArc * 3.0 - uTime * 2.5));
          float tear = fbm(vec2(P.x * 4.0 + uTime * 0.7, vArc * 2.0));
          float tipTear = smoothstep(0.55, 1.0, vArc) * (1.0 - smoothstep(0.35, 0.7, tear));
          if (tipTear > 0.5) discard;

          // fine ripples over the sheet
          N = normalize(N + (streak - 0.5) * 0.35 * vec3(1.0, 0.0, 0.4));

          float NdotL = max(dot(N, L), 0.0);
          float NdotV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

          // Thin sheet of water: strongly forward-scattering sunlight (the glowing green lip)
          float back = pow(max(dot(V, -L), 0.0), 2.0);
          float thin = 1.0 - vThick;
          vec3 body = mix(uWaterColor, uGlowColor * 1.6, 0.35 + 0.65 * thin) * (0.6 + 0.5 * NdotL + 0.9 * back * thin);
          // sky seen through the thinnest part of the sheet
          body = mix(body, uHorizonColor, 0.35 * thin * (1.0 - vFoam));

          vec3 R = reflect(-V, N);
          vec3 sky = mix(uHorizonColor, vec3(0.12, 0.3, 0.65), pow(clamp(R.y, 0.0, 1.0), 0.55));
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 300.0) * 3.0;

          vec3 col = mix(body, sky, F) + uSunColor * spec;

          // Aerated foam / spray along the curl edge and impact tip
          float foamAmt = clamp(vFoam * (0.6 + 0.6 * streak) + tipTear * 1.5, 0.0, 1.0);
          vec3 foamCol = uFoamColor * (0.6 + 0.5 * NdotL);
          col = mix(col, foamCol, foamAmt);

          float finalAlpha = vAlpha * mix(0.7 + 0.25 * (1.0 - thin), 0.95, foamAmt) * (1.0 - tipTear);

          gl_FragColor = vec4(col, finalAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });

    super(geometry, material);
    this.customMaterial = material;
    this.name = 'LipRibbon';
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
      // Must match RollingWaterSurface: far-modulation peel (amplitude, phase) so the lip follows the
      // diagonally closing crest line
      (this.customMaterial.uniforms.uEvtD.value[i] as THREE.Vector4).set(e.far ?? 0.0, e.farPhase, 0.0, 0.0);
      (this.customMaterial.uniforms.uEvtE.value[i] as THREE.Vector4).set(0.0, 0.75, 1.35, e.tilt * 0.3);
    }
  }
}
