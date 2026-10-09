// Breaker wave schedule & stage constants adapted from ShoreBreak for high-performance WebXR.

export interface BreakerEvent {
  name: string;
  t0: number;        // Base impact time (s)
  H: number;         // Nominal breaker height (m)
  zI: number;        // Landing z (m)
  c: number;         // Crest / bore speed (m/s)
  x0: number;        // Nucleation along-shore x (m)
  seed: number;
  hPeel: number;
  stand: number;
  kappa: number;
  wobble: number;
  waviness: number;
  tilt: number;
  hvar: number;
  style: number;     // 0 spilling .. 1 plunging
  spill: number;
  strength: number;
  bore: number;
  splash: number;
  farPhase: number;
}

export const BK_TABLE = {
  T:  [-6.0, -4.0, -3.0, -2.0, -1.4, -1.0, -0.8, -0.55, -0.40, -0.33, -0.22, -0.12, -0.04, 0.0, 0.12, 0.30, 0.60, 0.85],
  ZA: [-23.0, -15.5, -11.3, -7.0, -4.3, -2.55, -1.85, -1.08, -0.625, -0.511, -0.461, -0.472, -0.477, -0.481, -0.475, -0.46, -0.44, -0.43],
  YA: [0.20, 0.24, 0.28, 0.33, 0.41, 0.46, 0.50, 0.548, 0.56, 0.553, 0.484, 0.392, 0.346, 0.300, 0.200, 0.080, 0.010, 0.0],
  YT: [-0.10, -0.10, -0.10, -0.10, -0.09, -0.08, -0.068, -0.068, -0.068, -0.068, -0.068, -0.068, -0.068, -0.068, -0.06, -0.04, -0.02, 0.0],
  LF: [8.0, 7.0, 6.0, 4.0, 2.2, 1.4, 1.04, 0.60, 0.46, 0.42, 0.42, 0.40, 0.38, 0.36, 0.40, 0.60, 1.0, 1.2],
  UW: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.26, 0.12, 0.04, 0.02, 0.02, 0.02, 0.02, 0.05, 0.2, 0.3, 0.3],
  HW: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.62, 0.66, 0.54, 0.56, 0.53, 0.47, 0.41, 0.40, 0.5, 0.5, 0.5],
  M:  [1.6, 1.6, 1.6, 1.6, 1.6, 1.8, 2.0, 2.6, 3.2, 3.6, 4.5, 5.0, 5.5, 6.0, 4.0, 2.0, 2.0, 2.0],
  P:  [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 2.0, 2.0, 2.0, 2.0],
  ST: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.55, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.8, 0.3, 0.0, 0.0],
  LB: [4.0, 3.8, 3.6, 3.2, 2.9, 2.7, 2.6, 2.5, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.6, 3.0, 3.0],
};

function hermCoef(A: number[], T: number[], i: number) {
  const n = T.length, i0 = Math.max(i - 1, 0), i3 = Math.min(i + 2, n - 1);
  const h = T[i + 1] - T[i];
  const m1 = ((A[i + 1] - A[i0]) / Math.max(T[i + 1] - T[i0], 1e-4)) * h;
  const m2 = ((A[i3] - A[i]) / Math.max(T[i3] - T[i], 1e-4)) * h;
  const a = A[i], b = A[i + 1];
  return [a, m1, -3 * a - 2 * m1 + 3 * b - m2, 2 * a + m1 - 2 * b + m2];
}

export function generateStageGLSL(): string {
  const K = BK_TABLE, T = K.T, n = T.length;
  const f = (v: number) => { const s = (+v).toPrecision(7); return /[.e]/.test(s) ? s : s + '.0'; };
  const v4 = (a: number[]) => `vec4(${a.map(f).join(', ')})`;
  let code = `
struct BrkStage {
  float za; float ya; float yt; float lf; float uw; float hw; float m; float p; float st; float lb;
};

BrkStage brkStage(float tn) {
  float t0, iw;
  vec4 cz, cy, l0, l1, q0, q1;
`;
  for (let i = 0; i < n - 1; i++) {
    const lin0 = [K.YT[i], K.LF[i], K.UW[i], K.HW[i]], lin1 = [K.YT[i + 1] - K.YT[i], K.LF[i + 1] - K.LF[i], K.UW[i + 1] - K.UW[i], K.HW[i + 1] - K.HW[i]];
    const q0 = [K.M[i], K.P[i], K.ST[i], K.LB[i]], q1 = [K.M[i + 1] - K.M[i], K.P[i + 1] - K.P[i], K.ST[i + 1] - K.ST[i], K.LB[i + 1] - K.LB[i]];
    const cond = i < n - 2 ? `if (tn < ${f(T[i + 1])}) ` : '';
    code += `  ${i ? 'else ' : ''}${cond}{ t0 = ${f(T[i])}; iw = ${f(1 / (T[i + 1] - T[i]))}; cz = ${v4(hermCoef(K.ZA, T, i))}; cy = ${v4(hermCoef(K.YA, T, i))};
    l0 = ${v4(lin0)}; l1 = ${v4(lin1)}; q0 = ${v4(q0)}; q1 = ${v4(q1)}; }
`;
  }
  code += `  float fr = clamp((tn - t0) * iw, 0.0, 1.0);
  vec4 fp = vec4(1.0, fr, fr * fr, fr * fr * fr);
  vec4 l = l0 + l1 * fr, q = q0 + q1 * fr;
  BrkStage g;
  g.za = dot(cz, fp); g.ya = dot(cy, fp);
  g.yt = l.x; g.lf = l.y; g.uw = l.z; g.hw = l.w;
  g.m = q.x; g.p = q.y; g.st = q.z; g.lb = q.w;
  return g;
}
`;
  return code;
}

export const BREAKER_COMMON_GLSL = /* glsl */ `
#define MAX_EVENTS 6

uniform vec4 uEvtA[MAX_EVENTS]; // x: t0, y: H, z: zI, w: seed
uniform vec4 uEvtB[MAX_EVENTS]; // x: c, y: x0, z: wobble, w: strength
uniform vec4 uEvtC[MAX_EVENTS]; // x: kappa, y: waviness, z: hvar, w: style
uniform vec4 uEvtD[MAX_EVENTS]; // quadratic peel
uniform vec4 uEvtE[MAX_EVENTS]; // logistic peel & tilt
uniform int uEvtCount;

float brkTiming(int k, float x, out float outH, out float outZI) {
  vec4 A = uEvtA[k];
  vec4 B = uEvtB[k];
  vec4 C = uEvtC[k];
  vec4 D = uEvtD[k];
  vec4 E = uEvtE[k];
  
  float t0 = A.x;
  float H = A.y;
  float zI = A.z;
  float seed = A.w;
  
  float dx = x - B.y;
  float ds = sqrt(dx * dx + 0.25) - 0.5;
  float localPeel = (dx >= 0.0) ? (D.x * ds + D.y * ds * ds) : (D.z * ds + D.w * ds * ds);
  
  // Logistic peel
  float logPeel = E.x / (1.0 + exp(-clamp((x - E.y) / max(E.z, 0.1), -10.0, 10.0)));
  float wobble = B.z * (0.62 * sin(2.3 * x + 6.1 * seed) + 0.38 * sin(5.1 * x + 11.7 * seed));
  
  float ti = t0 + localPeel + logPeel + wobble;
  
  outH = H * (1.0 + C.z * sin(0.4 * x + seed * 8.0));
  outZI = zI + C.y * sin(0.3 * x + seed * 5.0) + E.w * x;
  return ti;
}

// Breaker face elevation and displacement
float brkElevation(vec3 pos, float time, out vec3 outDisp, out float outFoam) {
  float totalY = 0.0;
  outDisp = vec3(0.0);
  outFoam = 0.0;
  
  for (int k = 0; k < MAX_EVENTS; k++) {
    if (k >= uEvtCount) break;
    if (uEvtB[k].w <= 0.01) continue;
    
    float H, zI;
    float ti = brkTiming(k, pos.x, H, zI);
    float scale = H / 0.45;
    float tn = (time - ti) / max(sqrt(scale), 0.1);
    
    if (tn < -5.5 || tn > 0.8) continue;
    
    BrkStage st = brkStage(tn);
    float apexZ = zI + st.za * scale;
    float apexY = st.ya * scale;
    float troughY = st.yt * scale;
    float frontLen = max(st.lf * scale, 0.1);
    float backLen = max(st.lb * scale, 0.1);
    
    float dz = pos.z - apexZ;
    float eventY = 0.0;
    
    if (dz >= 0.0 && dz <= frontLen) {
      // Front face
      float u = dz / frontLen;
      float face = cos(u * 1.5707963);
      eventY = mix(troughY, apexY, pow(face, st.m));
      
      // Plunging steepness & overhang curl
      if (tn > -0.6 && tn < 0.2) {
        float curlFactor = smoothstep(-0.6, -0.2, tn) * (1.0 - smoothstep(0.0, 0.2, tn));
        outDisp.z += curlFactor * 0.45 * scale * sin(u * 3.14159);
        outDisp.y += curlFactor * 0.25 * scale * sin(u * 3.14159);
      }
      
      if (tn > -0.4 && u < 0.5) {
        outFoam += (1.0 - u * 2.0) * smoothstep(-0.4, 0.0, tn);
      }
    } else if (dz < 0.0 && dz >= -backLen) {
      // Back face
      float u = -dz / backLen;
      float sech = 1.0 / cosh(u * 2.5);
      eventY = mix(0.0, apexY, sech * sech);
    }
    
    totalY += eventY * uEvtB[k].w;
  }
  
  return totalY;
}
`;
