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
  far?: number;      // along-shore timing modulation amplitude (s): sections break 2*far apart
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

// Shared helpers: beach bathymetry (must match Shorebed.ts) and cheap procedural noise.
export const SHORE_COMMON_GLSL = /* glsl */ `
// Piecewise-linear and C0-continuous: the segments must meet exactly (-0.44 at z = -2, -3.14 at
// z = -20). An earlier version had a 36 cm bed step at z = -2 which the swell's depth-based
// shoaling factor turned into a permanent ~10 cm ledge in the water right at the break line.
float bedProfile(float z) {
  if (z < -20.0) return -3.14 + (z + 20.0) * 0.12;
  if (z < -2.0) return -0.44 + (z + 2.0) * 0.15;
  if (z < 4.0) return z * 0.22;
  return 0.88 + (z - 4.0) * 0.08;
}
float bedHeight(vec2 xz) {
  float n = sin(xz.x * 0.2) * cos(xz.y * 0.3) * 0.05 + sin(xz.x * 0.7 + xz.y * 0.5) * 0.02;
  return bedProfile(xz.y) + n;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise with analytic derivative: returns (value, d/dx, d/dy)
vec3 vnoised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  float k0 = a, k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  float v = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  return vec3(v, du.x * (k1 + k3 * u.y), du.y * (k2 + k3 * u.x));
}
float vnoise(vec2 p) { return vnoised(p).x; }
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(13.7, 7.1); a *= 0.5; }
  return v;
}
`;

export const BREAKER_COMMON_GLSL = /* glsl */ `
#define MAX_EVENTS 8

uniform vec4 uEvtA[MAX_EVENTS]; // x: t0, y: H, z: zI, w: seed
uniform vec4 uEvtB[MAX_EVENTS]; // x: c, y: x0, z: wobble, w: strength
uniform vec4 uEvtC[MAX_EVENTS]; // x: kappa, y: waviness, z: hvar, w: style
uniform vec4 uEvtD[MAX_EVENTS]; // x: far-modulation amplitude Af (s), y: phase psi
uniform vec4 uEvtE[MAX_EVENTS]; // logistic peel & tilt
uniform int uEvtCount;

// Bounded multi-nucleation timing along the beach (ShoreBreak farS): |farS| <= 1, its minima are
// the sections that break first (10-25 m apart) and the break peels both ways from there at
// ~5-10 m/s, so the crest closes out diagonally in sections instead of all at once. Being smooth
// and long-wavelength, it never produces the sharp zipper of a V-peel about one point.
// Only long wavelengths (34 m / 19 m): the former 11 m term made the impact time run along the
// beach at a visible pace, which read as a sideways sweep of the splash after every break.
float brkFarS(float x, float psi) {
  return 0.65 * sin(0.185 * x + 6.2831853 * psi)
       + 0.35 * sin(0.33 * x + 17.1 * psi + 1.3);
}
float brkFar(int k, float x) { return brkFarS(x, uEvtD[k].y); }

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
  
  // Far modulation: the section at the minimum of farS breaks first and is the bigger wave
  // (H -12 %), the late sections are smaller and land a little further up the beach (+0.25 m)
  float fs = brkFarS(x, D.y);
  float farPeel = D.x * fs;
  
  // Logistic peel
  float logPeel = E.x / (1.0 + exp(-clamp((x - E.y) / max(E.z, 0.1), -10.0, 10.0)));
  float wobble = B.z * (0.62 * sin(2.3 * x + 6.1 * seed) + 0.38 * sin(5.1 * x + 11.7 * seed));
  
  float ti = t0 + farPeel + logPeel + wobble;
  
  float farW = clamp(D.x / 0.6, 0.0, 1.0);
  outH = H * (1.0 + C.z * sin(0.4 * x + seed * 8.0)) * (1.0 - 0.12 * farW * fs);
  outZI = zI + C.y * sin(0.3 * x + seed * 5.0) + E.w * x + 0.25 * farW * fs;
  return ti;
}

// ---- Front-face shape functions (ported from ShoreBreak breaker.js) ----
// Gentle cosine face used far offshore.
float brkFcos(float u) { return 0.5 + 0.5 * cos(3.14159265 * u); }
// Steep face: a near-vertical upper wall of relative width uw that drops from the apex to the
// hollow shoulder height hw, then a power-law (m) slope down to the trough. This is what makes the
// wave hollow out and stand up under the lip instead of staying a smooth hump.
float brkFsteep(float u, float uw, float hw, float m, float p) {
  if (u < uw) {
    float r = u / max(uw, 1e-3);
    float q = max(1.0 - pow(r, p), 1e-5);
    return hw + (1.0 - hw) * pow(q, 1.0 / p);
  }
  float w = max((1.0 - u) / max(1.0 - uw, 1e-3), 0.0);
  return hw * pow(w, m);
}
// The cap/wall width is clamped to a few mesh rows (BRK_MIN_WALL metres): the table's 1-2 cm wall
// is far below any vertex spacing, so without the clamp the crest sampled as a one-row spike whose
// height jittered as the apex slid between rows. A plateau >= 1.5 rows wide samples stably.
#define BRK_MIN_WALL 0.09
float brkFace(BrkStage g, float u, float frontLen) {
  u = clamp(u, 0.0, 1.0);
  float uw = max(g.uw, BRK_MIN_WALL / max(frontLen, 0.1));
  return mix(brkFcos(u), brkFsteep(u, uw, g.hw, g.m, g.p), g.st);
}

// Impact splash pulse: unit-integral gamma in time (rises fast, decays over T)
float brkGamma(float tau, float T) { return tau > 0.0 ? tau / (T * T) * exp(-tau / T) : 0.0; }

// Swash-front lobes: convex tongues 1.2-3 m apart, seeded per event, so the bore front and the
// run-up break into irregular fingers rather than a ruler-straight line. Frequencies are kept
// below ~5 rad/m: the water mesh columns are ~0.45 m apart, finer terms alias into jitter.
float brkLobes(float x, float seed) {
  float wm = 1.1 * sin(0.9 * x + seed * 13.7) + 0.6 * sin(1.7 * x + seed * 29.3);
  return 0.26 * sin(2.6 * x + seed * 37.1 + 0.6 * wm) + 0.14 * sin(4.7 * x + seed * 91.7 + wm);
}
// Pitching drift: the stage table's apex track goes flat at -0.47 s from tn ~ -0.33, which froze
// the crest in place for half a second before it collapsed. A real crest keeps its momentum while
// it stands up and throws its lip, so the apex (and with it the lip root, the landing line and
// the bore) keeps gliding shoreward through the throw and only comes to rest as the lip lands.
// The drift eases in and out, so the apex speed is continuous: ~3 m/s on approach, slowing
// smoothly through the pitch instead of stopping dead.
float brkDrift(float scale, float tn) {
  float u = clamp((tn + 0.5) / 0.6, 0.0, 1.0);    // tn -0.5 .. 0.1
  // quintic ease: zero velocity at both ends, peak speed in the middle of the throw
  float e = u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
  return 0.65 * scale * e;
}
// Landing line of the thrown lip (apex z at rest after the throw)
float brkLandZ(float zI, float scale) { return zI + brkDrift(scale, 0.1); }
// Apex track: far from the break the track scales with sqrt(s) (speed ~ const), near it with s
float brkApexZ(float zI, float za, float scale, float rs, float tn) {
  return zI + za * mix(scale, rs, smoothstep(-0.8, -2.0, tn)) + brkDrift(scale, tn);
}
// Along a long beach the run-up varies by +-20 % over 10-40 m (per-event undulation + cusps)
float brkRunupMod(float x, float seed) {
  float und = 0.6 * sin(0.21 * x + seed * 7.3 + 0.5 * sin(0.09 * x + seed * 3.1)) + 0.4 * sin(0.47 * x + seed * 13.1);
  float horn = 1.0 - abs(sin(3.14159 * (x / 17.0 + 0.25 * sin(x / 23.0 + 1.1))));
  return 0.14 * und + 0.13 * (1.0 - 2.0 * horn * horn);
}

// Breaker face elevation and displacement.
// outFoam: x = fresh whitewater (crest / bore front), y = aged lace foam trail, z = thin swash film
float brkElevation(vec3 pos, float time, out vec3 outDisp, out vec3 outFoam) {
  float totalY = 0.0;
  outDisp = vec3(0.0);
  outFoam = vec3(0.0);
  
  for (int k = 0; k < MAX_EVENTS; k++) {
    if (k >= uEvtCount) break;
    if (uEvtB[k].w <= 0.01) continue;
    
    float H, zI;
    float ti = brkTiming(k, pos.x, H, zI);
    float seed = uEvtA[k].w;
    float style = uEvtC[k].w;
    float strength = uEvtB[k].w;
    float scale = H / 0.45;
    float rs = max(sqrt(scale), 0.1);
    float tn = (time - ti) / rs;
    
    if (tn < -5.5) continue;
    // the heightfield only exists seaward of the beach face
    float shoreFade = 1.0 - smoothstep(-0.6, 0.6, pos.z);

    // ---- Impact splash-up: the plunging lip slams into the trough and throws an aerated
    // sheet upward and shoreward (gamma pulse, strongest for plunging style); the collapsing
    // crest remnant then rolls over into the turbulent roller behind the landing line ----
    float tau = time - ti;
    float zL = brkLandZ(zI, scale);
    // The pulses are deliberately slow (T 0.55 / 0.8 s) and damped on far-modulated events: a
    // sharp pulse riding the along-shore impact-time gradient reads as a bright spot racing
    // sideways along the beach after the break; a soft, longer one just brightens the landing line.
    float pulseW = 1.0 - 0.45 * clamp(uEvtD[k].x / 0.6, 0.0, 1.0);
    if (tau > 0.0 && tau < 3.6) {
      float throwF = mix(0.3, 1.0, smoothstep(0.4, 0.75, style)) * pulseW;
      float tJ = tau + 0.04;
      float zJ = zL + 0.1 + 1.4 * throwF * tJ;
      float sJ = 0.36 * rs + 0.3 * tJ;
      float gJ = brkGamma(tJ, 0.55) * 0.55;
      float gz = exp(-0.5 * pow((pos.z - zJ) / sJ, 2.0));
      // the splash curtain is a little taller where the lip landed first (slow along-shore modulation)
      float rag = 0.85 + 0.15 * sin(pos.x * 2.1 + seed * 21.0);
      float splashY = 0.26 * scale * throwF * gJ * gz * rag;
      totalY += splashY * strength * shoreFade;
      outFoam.x += 1.3 * gJ * gz * strength;
      float tR = tau - 0.12;
      float zR = zL - 0.35 * scale + 0.9 * max(tR, 0.0);
      float sR = 0.4 * rs + 0.18 * max(tR, 0.0);
      float gR = brkGamma(tR, 0.8) * 0.8 * pulseW;
      float gzR = exp(-0.5 * pow((pos.z - zR) / sR, 2.0));
      totalY += 0.16 * scale * gR * gzR * strength * shoreFade;
      outFoam.x += 0.9 * gR * gzR * strength;
      outFoam.y += 0.5 * gR * gzR * strength;
    }

    // Post-impact bore: whitewater rolls shoreward, decelerates, thins into the swash run-up.
    // It grows in over tn 0.45-0.85 while the collapsing crest heightfield fades out, so the
    // transition is a continuous roll-over rather than a shape swap.
    if (tn > 0.45) {
      float tb = max(time - ti - 0.45 * rs, 0.0);
      if (tb <= 9.0) {
        float grow = smoothstep(0.45, 0.85, tn);
        float c = uEvtB[k].x * (1.0 + 0.5 * brkRunupMod(pos.x, seed));
        // fingers grow with bore momentum excess and smooth out as the front slows
        float lobe = brkLobes(pos.x, seed) * (0.25 + 0.45 * smoothstep(0.0, 2.5, tb)) * (1.0 - smoothstep(5.0, 9.0, tb));
        float zF = zL - 0.3 * scale + c * tb / (1.0 + 0.12 * tb) + lobe;
        float hb = (0.24 * scale * exp(-0.28 * tb) + 0.05 * scale * exp(-0.08 * tb));
        // rounded, tumbling roller crest on the bore front over a long back slope
        float front = 1.0 - smoothstep(zF - 1.1 * scale, zF + 0.15, pos.z);
        float roller = exp(-pow((pos.z - zF + 0.45 * scale) / (0.45 * scale), 2.0)) * exp(-0.4 * tb);
        float back = smoothstep(zL - 5.0 * scale, zL - 1.0 * scale, pos.z);
        // Run-up tongue: a thin sheet that keeps climbing the beach a little past the bore front
        float tongue = (1.0 - smoothstep(zF, zF + 1.4, pos.z)) * smoothstep(zF - 1.0, zF, pos.z);
        float eventYb = hb * front * back + 0.07 * scale * roller + 0.035 * tongue * exp(-0.2 * tb);
        totalY += eventYb * strength * grow;
        float frontBand = smoothstep(zF - 1.6 * scale, zF - 0.1, pos.z) * (1.0 - smoothstep(zF, zF + 0.6, pos.z));
        outFoam.x += (frontBand * exp(-0.35 * tb) + roller * 0.8) * strength * grow;
        outFoam.y += front * back * (0.75 * exp(-0.12 * tb)) * strength * grow;
        outFoam.z += tongue * exp(-0.15 * tb) * grow;
      }
      if (tn > 0.85) continue;
    }
    
    BrkStage st = brkStage(tn);
    float apexZ = brkApexZ(zI, st.za, scale, rs, tn);
    float apexY = st.ya * scale;
    float troughY = st.yt * scale;
    float frontLen = max(st.lf * scale, 0.1);
    float backLen = max(st.lb * scale, 0.1);
    // the swell is born offshore, and the collapsed crest melts into the bore after the impact
    float amp = smoothstep(-18.0, -11.0, apexZ) * (1.0 - smoothstep(0.6, 0.85, tn)) * shoreFade;
    
    float dz = pos.z - apexZ;
    float eventY = 0.0;
    
    if (dz >= 0.0 && dz <= frontLen * 1.1) {
      // Front face: cosine offshore, hollow near-vertical wall + flat shoulder as it steepens (st).
      // The heightfield stays single-valued (as in ShoreBreak): the overhanging lip is the
      // separate LipRibbon sheet, so the mesh never folds over itself. Extended slightly past
      // frontLen to overlap smoothly with the trough tail for all waves.
      float u = clamp(dz / frontLen, 0.0, 1.0);
      float F = brkFace(st, u, frontLen);
       eventY = mix(troughY, apexY, F);
       
       // Feathering: patchy whitecap along the crest top before the lip is thrown, continuous
       // on a spilling crest; then the whole crest turns white as the lip throws
       float patchy = smoothstep(0.15, 0.75, 0.5 + 0.5 * sin(pos.x * 3.3 + seed * 17.0) * sin(pos.x * 1.7 + seed * 5.0 + 1.0));
       // a section that breaks late on the far modulation stands up longer and feathers into a
       // spilling shoulder before it throws (ShoreBreak's stall), so the diagonal closeout reads
       // as plunging peak -> whitecapping shoulder rather than identical barrels delayed in time
      float late = clamp(uEvtD[k].x / 0.6, 0.0, 1.0) * (0.5 + 0.5 * brkFar(k, pos.x));
      float spill = clamp(1.0 - smoothstep(0.3, 0.8, style) + 0.45 * late, 0.0, 1.0);
      float onset = mix(-0.85, -0.3, spill);
      float whitecap = mix(smoothstep(onset, onset + 0.4, tn) * 0.45 * patchy, smoothstep(onset, onset + 0.12, tn), spill);
      float crestTop = exp(-pow((1.0 - F) / (0.09 + 0.12 * spill), 2.0));
      outFoam.x += whitecap * crestTop;
      // the thrown lip's rim and spray streak down the hollow face at impact
      outFoam.x += smoothstep(-0.3, 0.1, tn) * pow(F, 2.0 + 2.0 * st.st) * 0.85;
      outFoam.x += smoothstep(-0.15, 0.1, tn) * st.st * smoothstep(0.3, 1.0, F) * 0.5 * (0.7 + 0.3 * sin(pos.x * 4.1 + seed * 9.0));
    } else if (dz > frontLen && dz < frontLen + 2.5 * scale) {
      // trough tail: the depressed trough in front of the face relaxes back to the mean level.
      // Normalised so it reaches exactly zero at its end: a bare exp(-e^2) still held 37 % of
      // the trough depth there and dropped to the sea level in one row - a visible ledge in the
      // water just seaward of the break line. Extended to 2.5*scale to ensure all waves have
      // smooth continuity regardless of their height or stage parameters.
      float e = (dz - frontLen) / (2.5 * scale);
      float tailE = exp(-1.0);
      eventY = troughY * max(exp(-e * e) - tailE, 0.0) / (1.0 - tailE);
    } else if (dz < 0.0 && dz >= -backLen) {
      // Back face: sech^2 that reaches zero exactly at -backLen (no step at the tail)
      float u = -dz / backLen;
      float sech = 1.0 / cosh(u * 2.5);
      float tail = 1.0 / cosh(2.5);
      eventY = apexY * max(sech * sech - tail * tail, 0.0) / (1.0 - tail * tail);
      // Spilling whitewater tumbles down the back of the crest after impact
      outFoam.x += smoothstep(-0.1, 0.3, tn) * sech * sech * 0.9;
      outFoam.y += smoothstep(0.0, 0.5, tn) * sech * 0.5;
    }
    
    totalY += eventY * strength * amp;
  }
  
  return totalY;
}
`;
