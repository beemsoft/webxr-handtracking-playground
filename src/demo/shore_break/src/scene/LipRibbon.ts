import * as THREE from 'three';
import { generateStageGLSL, BREAKER_COMMON_GLSL, BreakerEvent } from './BreakerWave';

// Dynamic plunging lip mesh representing the overturning curling jet (barrel) of breaking waves.
export class LipRibbon extends THREE.Mesh {
  private customMaterial: THREE.ShaderMaterial;

  constructor() {
    // Build ribbon geometry with segments around the barrel curl and along the shore
    const cols = 64;  // Along-shore cross sections
    const rows = 32;  // Around the curl cross section
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
        uWaterColor: { value: new THREE.Color(0x1990a3) },
        uFoamColor: { value: new THREE.Color(0xf0fbff) },
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
        varying float vAlpha;
        varying float vFoam;

        uniform float uTime;
        ${stageGLSL}
        ${BREAKER_COMMON_GLSL}

        void main() {
          vUv = uv;
          vec3 p = position;
          float x = p.x;
          float arc = p.z; // 0 (apex) to 1 (plunging jet landing tip)
          
          float totalAlpha = 0.0;
          float totalFoam = 0.0;
          vec3 finalPos = vec3(x, -100.0, 0.0); // Hidden if no active breaker
          vec3 finalNorm = vec3(0.0, 1.0, 0.0);

          for (int k = 0; k < MAX_EVENTS; k++) {
            if (k >= uEvtCount) break;
            if (uEvtB[k].w <= 0.01) continue;

            float H, zI;
            float ti = brkTiming(k, x, H, zI);
            float scale = H / 0.45;
            float tn = (uTime - ti) / max(sqrt(scale), 0.1);

            // Active plunging window
            if (tn >= -0.45 && tn <= 0.25) {
              BrkStage st = brkStage(tn);
              float apexZ = zI + st.za * scale;
              float apexY = st.ya * scale;
              float troughY = st.yt * scale;
              
              // Ballistic parabolic trajectory for plunging lip
              // Lip throws forward and down in a curling arch
              float throwProg = smoothstep(-0.45, 0.0, tn);
              float throwDist = (0.7 + 0.6 * throwProg) * scale;
              float curlDrop = (apexY - troughY) * (1.0 + 0.3 * throwProg);

              // Parametric arc around the barrel
              // arc: 0 is crest apex, 0.5 is forward lip overhanging edge, 1.0 is impact tip
              float theta = arc * 3.14159265;
              float lipZ = apexZ + sin(theta) * throwDist;
              float lipY = apexY - (1.0 - cos(theta)) * 0.5 * curlDrop;

              // Jet thinning and extension
              float activeAlpha = smoothstep(-0.45, -0.35, tn) * (1.0 - smoothstep(0.05, 0.25, tn));
              
              if (activeAlpha > totalAlpha) {
                totalAlpha = activeAlpha;
                finalPos = vec3(x, lipY, lipZ);
                
                // Normal around curling tube
                vec3 tangentZ = vec3(0.0, -sin(theta) * 0.5 * curlDrop, cos(theta) * throwDist);
                vec3 tangentX = vec3(1.0, 0.0, 0.0);
                finalNorm = normalize(cross(tangentZ, tangentX));
                
                totalFoam = smoothstep(0.4, 0.9, arc) + smoothstep(-0.1, 0.1, tn);
              }
            }
          }

          vAlpha = totalAlpha;
          vFoam = clamp(totalFoam, 0.0, 1.0);
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

        uniform vec3 uSunDirection;
        uniform vec3 uWaterColor;
        uniform vec3 uFoamColor;

        void main() {
          if (vAlpha <= 0.01) discard;

          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDirection);
          vec3 V = normalize(cameraPosition - vWorldPosition);

          float NdotL = max(dot(N, L), 0.0);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          
          // Translucent water body
          vec3 waterCol = mix(uWaterColor * 0.7, uWaterColor * 1.3, NdotL);
          
          // Specular sun glint
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 64.0) * 1.5;
          
          // Aerated foam on curling edge and impact tip
          vec3 finalColor = mix(waterCol, uFoamColor, vFoam * 0.85) + vec3(spec);
          float finalAlpha = vAlpha * mix(0.75, 0.95, vFoam);

          gl_FragColor = vec4(finalColor, finalAlpha);
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
