import * as THREE from 'three';
import { U } from '../core/SharedUniforms';
import { OCEAN_SAMPLE_GLSL } from './OceanSampleGLSL';
import { NOISE_GLSL } from '../gfx/NoiseGLSL';
import { ATMO_COMMON } from '../sky/AtmosphereGLSL';
import { AERIAL_GLSL } from '../sky/Atmosphere';
import { SHADING_GLSL } from '../gfx/ShadingGLSL';
import { OceanFFT } from './OceanFFT';
import { Atmosphere } from '../sky/Atmosphere';
import { Quality } from '../core/Quality';

function buildProjectedGrid(nx: number, ny: number): THREE.BufferGeometry {
  const vertCount = (nx + 1) * (ny + 1);
  const grid = new Float32Array(vertCount * 2);
  let o = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      grid[o++] = i / nx;
      grid[o++] = j / ny;
    }
  }
  const idx = new Uint32Array(nx * ny * 6);
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = d;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const VERT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 aGrid;

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 uViewProjNJ;
uniform mat4 uPrevViewProjNJ;
uniform mat4 uInvViewProjNJ;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uRMax;
uniform vec2 uGridSize;
uniform float uGridMargin;
uniform float uSkirt;
uniform float uGridPlane;
uniform float uCurrentStrength;
uniform float uDisplaceScale;
uniform int uEventSteps;
uniform int uEventBisect;

${OCEAN_SAMPLE_GLSL}

out vec3 vWorldPos;
out vec2 vFlatPos;
out vec3 vDisp;
out float vDist;
out float vCrest;
out float vCalm;
out float vWaveY;
out float vEventY;
out vec3 vLods;
out vec4 vClipNJ;
out vec4 vPrevClipNJ;

vec3 rayFor(vec2 ndc, mat4 invVP) {
  vec4 a = invVP * vec4(ndc, -1.0, 1.0);
  vec4 b = invVP * vec4(ndc,  1.0, 1.0);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}

void bandSoliton(vec4 s, vec4 sb, vec2 o, vec2 d, inout vec2 span) {
  if (s.w <= 0.001) return;
  vec2 sd = normalize(s.xy);
  float w = max(sb.x, 1.0) * 3.0;
  float x0 = dot(o, sd) - s.z;
  float k = dot(d, sd);
  vec2 seg;
  if (abs(k) < 1e-5) {
    if (abs(x0) > w) return;
    seg = vec2(0.0, 1e7);
  } else {
    float a = (-w - x0) / k, b = (w - x0) / k;
    seg = vec2(min(a, b), max(a, b));
  }
  span = vec2(min(span.x, seg.x), max(span.y, seg.y));
}

void bandDisc(vec2 c, float r, float amp, vec2 o, vec2 d, inout vec2 span) {
  if (amp <= 0.001) return;
  vec2 m = o - c;
  float b = dot(m, d);
  float cc = dot(m, m) - r * r;
  float disc = b * b - cc;
  if (disc < 0.0) return;
  float sq = sqrt(disc);
  span = vec2(min(span.x, -b - sq), max(span.y, -b + sq));
}

float eventRayHit(vec3 dir, vec2 o2, float eye, float lo, float hi) {
  float a = lo, b = hi;
  float ta = -1.0, tb = 0.0;

  for (int pass = 0; pass < 2; pass++) {
    float dt = (b - a) / float(uEventSteps);
    float tPrev = a;
    float gPrev = eye + dir.y * a - oceanEventHeight(o2 + dir.xz * a);
    float gMin = gPrev, tMin = a;
    for (int i = 1; i <= uEventSteps; i++) {
      float tc = a + dt * float(i);
      float gc = eye + dir.y * tc - oceanEventHeight(o2 + dir.xz * tc);
      if (ta < 0.0 && gPrev > 0.0 && gc <= 0.0) { ta = tPrev; tb = tc; }
      if (gc < gMin) { gMin = gc; tMin = tc; }
      tPrev = tc; gPrev = gc;
    }
    if (ta > 0.0) break;
    a = max(tMin - dt, lo);
    b = min(tMin + dt, hi);
  }
  if (ta < 0.0) return -1.0;

  for (int i = 0; i < uEventBisect; i++) {
    float tm = 0.5 * (ta + tb);
    if (eye + dir.y * tm - oceanEventHeight(o2 + dir.xz * tm) > 0.0) ta = tm; else tb = tm;
  }
  return 0.5 * (ta + tb);
}

vec2 seaHit(vec3 dir, float eyeHeight) {
  float curv = uEarthCurvature / (2.0 * EARTH_R);
  float a = max((1.0 - dir.y * dir.y) * curv, 1e-14);
  float b = dir.y;
  float c = eyeHeight;
  float disc = b * b - 4.0 * a * c;
  float t = 0.0;
  bool miss = true;
  if (disc >= 0.0) {
    float sq = sqrt(disc);
    float qq = -0.5 * (b + (b >= 0.0 ? sq : -sq));
    float r1 = qq / a;
    float r2 = abs(qq) > 1e-20 ? c / qq : -1.0;
    float lo = min(r1, r2), hi = max(r1, r2);
    t = lo > 0.02 ? lo : hi;
    miss = t <= 0.02;
  }
  if (miss || t > uRMax) {
    float rh = sqrt(max(2.0 * EARTH_R * max(abs(c), 0.05) * uEarthCurvature, 1.0));
    rh = min(rh, uRMax);
    if (uEarthCurvature < 0.5) rh = uRMax;
    float horiz = max(length(dir.xz), 1e-5);
    t = rh / horiz;
    return vec2(t, 1.0);
  }
  return vec2(t, 0.0);
}

void main(){
  mat4 invVP = inverse(projectionMatrix * viewMatrix);
  vec2 cellIdx = aGrid * uGridSize;
  vec2 atMin = step(cellIdx, vec2(0.5));
  vec2 atMax = step(uGridSize - 0.5, cellIdx);
  vec2 ndc = (aGrid * 2.0 - 1.0) * uGridMargin + (atMax - atMin) * uSkirt;
  vec3 dir = rayFor(ndc, invVP);
  float eyeHeight = max(uCamPos.y - (uSeaLevel + uGridPlane), 0.35);

  vec2 hit = seaHit(dir, eyeHeight);
  float t = hit.x;
  float snapped = hit.y;

  float horiz = length(dir.xz);
  float eventSpread = 0.0;
  if (horiz > 1e-5) {
    vec2 d2 = dir.xz / horiz;
    vec2 o2 = uCamPos.xz;
    vec2 span = vec2(1e9, -1e9);
    bandSoliton(uSoliton0, uSoliton0b, o2, d2, span);
    bandSoliton(uSoliton1, uSoliton1b, o2, d2, span);
    bandDisc(uRogue.xy, uRogue.z * 2.4, uRogue.w, o2, d2, span);
    bandDisc(uHurricane.xy, uHurricane.z * 3.0, uHurricane.w, o2, d2, span);
    bandDisc(uVortex0.xy, uVortex0.z * 3.0, uVortex0.w, o2, d2, span);
    bandDisc(uVortex1.xy, uVortex1.z * 3.0, uVortex1.w, o2, d2, span);
    bandDisc(uVortex2.xy, uVortex2.z * 3.0, uVortex2.w, o2, d2, span);
    bandDisc(uVortex3.xy, uVortex3.z * 3.0, uVortex3.w, o2, d2, span);

    if (span.y > span.x) {
      float lo = max(span.x / horiz, 0.05);
      float hi = min(span.y / horiz, uRMax);
      if (snapped < 0.5) hi = min(hi, t * 1.06 + 60.0);
      hi = min(hi, lo + 8000.0);

      if (hi > lo) {
        float tHit = eventRayHit(dir, o2, uCamPos.y - uSeaLevel, lo, hi);
        if (tHit > 0.0) {
          t = clamp(tHit, 0.05, uRMax);
          snapped = 0.0;
          float hs = max(t * 0.02, 0.5);
          float dEdt = (oceanEventHeight(o2 + dir.xz * (t + hs))
                      - oceanEventHeight(o2 + dir.xz * t)) / hs;
          eventSpread = t / max(abs(dir.y - dEdt), 2e-3);
        }
      }
    }
  }

  vec2 world = uCamPos.xz + dir.xz * t;

  vec2 ndcDu = (vec2(aGrid.x + 1.0 / uGridSize.x, aGrid.y) * 2.0 - 1.0) * uGridMargin;
  vec2 ndcDv = (vec2(aGrid.x, aGrid.y + 1.0 / uGridSize.y) * 2.0 - 1.0) * uGridMargin;
  vec3 dirU = rayFor(ndcDu, invVP);
  vec3 dirV = rayFor(ndcDv, invVP);

  float tScale = t / max(hit.x, 1e-3);
  vec2 wu = uCamPos.xz + dirU.xz * (seaHit(dirU, eyeHeight).x * tScale);
  vec2 wv = uCamPos.xz + dirV.xz * (seaHit(dirV, eyeHeight).x * tScale);

  float angU = length(dirU - dir), angV = length(dirV - dir);
  float pixel = max(t * angU, eventSpread * angV);
  float cell = max(max(length(wu - world), length(wv - world)), max(0.015, pixel));

  vec3 texel = uOceanScales / uOceanTexels;
  vec3 lods = log2(max(vec3(cell) / texel, vec3(1.0)));
  vLods = lods;

  vec2 q = swirlCoords(world, uTime);
  q = warpCoord(q, uTime, uCurrentStrength);

  float foamHint;
  vec3 disp = oceanDisplacementLod(q, lods, foamHint) * uDisplaceScale;

  float crest, calm;
  vec3 mods = oceanModifiers(world, uTime, crest, calm);
  disp *= (1.0 - calm * 0.8);

  float waveY = disp.y;
  disp += mods;

  float horizonFade = 1.0 - snapped * 0.92;
  disp *= horizonFade;
  vWaveY = waveY * horizonFade;
  vEventY = mods.y * horizonFade;

  vec3 wp = vec3(world.x + disp.x, uSeaLevel + disp.y, world.y + disp.z);
  wp.y -= earthDrop(world, uCamPos);

  vWorldPos = wp;
  vFlatPos = world;
  vDisp = disp;
  vDist = length(wp - uCamPos);
  vCrest = crest;
  vCalm = calm;

  vClipNJ = uViewProjNJ * vec4(wp, 1.0);
  vPrevClipNJ = uPrevViewProjNJ * vec4(wp, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uWeatherMap;
uniform float uWeatherScaleM;
uniform float uCoverage;
uniform float uCloudContrast;
uniform float uCloudDensity;
uniform float uCloudBottom;
uniform vec2 uCloudWind;
uniform float uCloudTime;
uniform sampler2D uEnvMap;
uniform float uEnvMaxLod;
uniform float uEnvWidth;
uniform sampler2D uFoamTex;
uniform sampler2D uRippleTex;
uniform float uRain;
uniform float uWhitecapCoverage;
uniform float uStormFactor;
uniform vec3 uWaterScatter;
uniform vec3 uWaterAbsorb;
uniform float uFoamStrength;
uniform float uCurrentStrength;
uniform vec4 uLightning0;
uniform vec4 uLightning1;
uniform vec3 uLightningColor;
uniform float uAmbientFlash;
uniform float uExposure;
uniform float uUnderwater;
uniform float uDebugMode;

${ATMO_COMMON}
${AERIAL_GLSL}
${NOISE_GLSL}
${OCEAN_SAMPLE_GLSL}
${SHADING_GLSL}

in vec3 vWorldPos;
in vec2 vFlatPos;
in vec3 vDisp;
in float vDist;
in float vCrest;
in float vCalm;
in float vWaveY;
in float vEventY;
in vec3 vLods;
in vec4 vClipNJ;
in vec4 vPrevClipNJ;

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oVelocity;

vec4 sampleCascadeGrad(sampler2D tex, vec2 q, float scale, vec2 ddx, vec2 ddy) {
  return textureGrad(tex, q / scale, ddx / scale, ddy / scale);
}

float cloudShadow(vec3 p, vec3 L) {
  if (uCoverage <= 0.001) return 1.0;
  float up = max(L.y, 0.22);
  vec2 xz = p.xz + L.xz / up * max(uCloudBottom - p.y, 0.0);

  vec2 w = xz + uCloudWind * uCloudTime * 0.6;
  vec4 m = textureLod(uWeatherMap, w / uWeatherScaleM, 0.0);
  vec4 n = textureLod(uWeatherMap, w / (uWeatherScaleM * 0.27)
                 + vec2(0.37, 0.11) - uCloudWind * uCloudTime * 0.00002, 0.0);
  float field = m.r * 0.62 + m.g * 0.22 + n.g * 0.16;
  float cov = clamp((field - 0.5) * uCloudContrast + uCoverage, 0.0, 1.0);
  float od = smoothstep(0.04, 0.62, cov) * uCloudDensity * 4.2 / up;
  return exp(-od);
}

void main(){
  vec2 q = swirlCoords(vFlatPos, uTime);
  q = warpCoord(q, uTime, uCurrentStrength);

  vec2 ddx = dFdx(q);
  vec2 ddy = dFdy(q);

  float fpA = length(ddx), fpB = length(ddy);
  float fpMajor = max(fpA, fpB);
  float fpMinor = max(max(min(fpA, fpB), fpMajor / max(uOceanAniso, 1.0)), 1e-5);
  float fpShade = sqrt(fpMinor * fpMajor);

  vec4 d0 = sampleCascadeGrad(uOceanDeriv0, q, uOceanScales.x, ddx, ddy) * uCascadeGain.x;
  vec4 d1 = sampleCascadeGrad(uOceanDeriv1, q, uOceanScales.y, ddx, ddy) * uCascadeGain.y;
  vec4 d2 = sampleCascadeGrad(uOceanDeriv2, q, uOceanScales.z, ddx, ddy) * uCascadeGain.z;
  vec4 dsum = d0 + d1 + d2;

  vec2 slope = vec2(dsum.x / max(1.0 + dsum.z, 0.05), dsum.y / max(1.0 + dsum.w, 0.05));
  slope *= (1.0 - vCalm * 0.85);
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  float microFade = 1.0 - smoothstep(0.35, 2.2, fpShade);
  if (microFade > 0.004) {
    vec2 wdir = normalize(uWindDir + 1e-5);
    vec2 drift = wdir * uTime;
    mat2 rotA = mat2( 0.8339, 0.5519, -0.5519, 0.8339);
    mat2 rotB = mat2(-0.2225, 0.9749, -0.9749, -0.2225);
    vec2 qA = rotA * q, qB = rotB * q;
    vec3 r0 = textureGrad(uRippleTex, q * 0.0131 + drift * 0.0075,
                          ddx * 0.0131, ddy * 0.0131).xyz * 2.0 - 1.0;
    vec3 r1 = textureGrad(uRippleTex, qA * 0.0474 - drift * 0.019,
                          rotA * ddx * 0.0474, rotA * ddy * 0.0474).xyz * 2.0 - 1.0;
    vec3 r2 = textureGrad(uRippleTex, qB * 0.1327 + drift * 0.041,
                          rotB * ddx * 0.1327, rotB * ddy * 0.1327).xyz * 2.0 - 1.0;
    vec2 micro = r0.xz * 0.46 + (r1.xz * rotA) * 0.33 + (r2.xz * rotB) * 0.21;
    micro *= microFade * (0.05 + 0.011 * uWindSpeed);
    N = normalize(N + vec3(micro.x, 0.0, micro.y));
  }

  float rainRip = 0.0;
  if (uRain > 0.01) {
    float f = exp(-vDist * 0.012);
    if (f > 0.004) {
      vec2 cellUv = q * 2.2;
      vec2 ci = floor(cellUv);
      vec2 cf = fract(cellUv) - vec2(0.5);
      float rnd = hash12(ci);
      float phase = fract(uTime * (0.9 + rnd * 0.6) + rnd);
      float rad = phase * 0.48;
      float dd = length(cf);
      float ring = exp(-pow((dd - rad) * 26.0, 2.0)) * (1.0 - phase) * step(rnd, uRain * 0.85);
      vec2 dir = normalize(cf + 1e-5);
      N = normalize(N + vec3(dir.x, 0.0, dir.y) * ring * 1.35 * f);
      rainRip = ring * f;
    }
  }

  bool underwater = uUnderwater > 0.5;
  vec3 V = normalize(uCamPos - vWorldPos);
  bool backLit = dot(N, V) < 0.0;
  if (backLit) N = -N;
  underwater = underwater || backLit;

  float mssTotal = 0.003 + 0.00512 * max(uWindSpeed, 0.5);
  vec3 share = vec3(0.06, 0.30, 0.64);
  vec3 sampledLod = log2(max(vec3(fpShade) * (uOceanTexels / uOceanScales), vec3(1.0)));
  float lost = share.x * clamp(sampledLod.x / 6.0, 0.0, 1.0)
             + share.y * clamp(sampledLod.y / 6.0, 0.0, 1.0)
             + share.z * clamp(sampledLod.z / 6.0, 0.0, 1.0);
  lost = max(lost, 1.0 - microFade * 0.9);
  float mssUnres = mssTotal * lost + 0.0009;
  float alpha = clamp(sqrt(2.0 * mssUnres), 0.012, 0.62);
  float roughness = clamp(sqrt(alpha), 0.02, 0.86);

  vec4 t0 = sampleCascadeGrad(uOceanTurb0, q, uOceanScales.x, ddx, ddy);
  vec4 t1 = sampleCascadeGrad(uOceanTurb1, q, uOceanScales.y, ddx, ddy);
  vec4 t2 = sampleCascadeGrad(uOceanTurb2, q, uOceanScales.z, ddx, ddy);
  float rawFoam = max(max(t0.r * 0.75, t1.r), t2.r * 0.45);
  float bubbles = t0.g * 0.35 + t1.g * 0.7 + t2.g * 0.3;

  float foamMask = (rawFoam * uFoamStrength + vCrest * 0.8) * (1.0 - vCalm * 0.9);

  vec2 wd = normalize(uWindDir + vec2(1e-5, 0.0));
  mat2 windFrame = mat2(wd.x, -wd.y, wd.y, wd.x);
  vec2 qs = windFrame * q;
  vec2 stretch = vec2(0.22, 1.0);
  float t = uTime;
  vec2 gx = windFrame * ddx, gy = windFrame * ddy;
  vec4 fx0 = textureGrad(uFoamTex, qs * 0.031 * stretch + vec2(t * 0.004, -t * 0.003),
                         gx * 0.031 * stretch, gy * 0.031 * stretch);
  vec4 fx1 = textureGrad(uFoamTex, qs * 0.145 * stretch - vec2(t * 0.011, t * 0.008),
                         gx * 0.145 * stretch, gy * 0.145 * stretch);
  vec4 fx2 = textureGrad(uFoamTex, q * 0.62 + vec2(-t * 0.03, t * 0.021), ddx * 0.62, ddy * 0.62);
  float foamNoise = fx0.a * 0.5 + fx1.a * 0.42 + fx2.a * 0.22;
  float foamDetail = fx1.r * 0.55 + fx2.r * 0.45;
  float foamFine = fx2.g * 0.6 + fx1.g * 0.4;

  float onset = mix(0.62, 0.26, clamp(uWhitecapCoverage / 0.16, 0.0, 1.0));
  float carved = foamMask * (0.10 + foamNoise * 1.55);
  float foam = smoothstep(onset, onset + 0.30, carved);
  foam *= mix(0.35, 1.0, foamDetail);
  float foamThin = smoothstep(onset * 0.55, onset + 0.30, carved);

  N = normalize(N + vec3(fx2.r - fx2.b, 0.0, fx2.g - fx2.a) * foam * 0.35 * microFade);

  float NoV = max(dot(N, V), 1e-4);
  vec3 L = normalize(uSunDir);
  float NoL = dot(N, L);

  vec3 tluPos = vec3(0.0, groundRadiusMM + max(uCamPos.y, 0.2) * 1e-6, 0.0);
  vec3 sunTrans = getValFromTLUT(uTransmittanceLUT, tluPos, uSunDir);
  vec3 sun = uSunColor * sunTrans * uSunIntensity * cloudShadow(vWorldPos, L);
  vec3 R = reflect(-V, N);

  float rUp = R.y;
  if (rUp < 0.0) R = normalize(vec3(R.x, mix(0.02, 0.35, roughness) - rUp * 0.15, R.z));

  float lobeTexels = alpha * 0.5 / (6.2831853 / max(uEnvWidth, 8.0));
  float envLod = clamp(log2(max(lobeTexels, 1.0)), 0.0, uEnvMaxLod);
  vec3 env = textureLod(uEnvMap, dirToEquirect(R), envLod).rgb;
  vec3 skyAmb = skyIrradiance(uEnvMap, uEnvMaxLod);

  float F = fresnelWater(NoV, roughness);

  vec3 spec = vec3(0.0);
  if (NoL > 0.0) {
    vec3 H = normalize(L + V);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 1e-4);
    float a = alpha;
    float aP = clamp(a + 0.00465 / 2.0, 0.0, 1.0);
    float norm = (a * a) / (aP * aP);
    float D = ggxD(NoH, aP);
    float Vis = smithGGXCorrelated(NoV, max(NoL, 1e-4), a);
    float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
    spec = sun * D * Vis * Fs * NoL * norm;
  }

  vec3 bodyR = uWaterScatter;
  float heightNorm = clamp(vWaveY * 0.35 + 0.35, 0.0, 1.5);
  float thinness = 1.0 / (1.0 + max(vEventY, 0.0) * 0.075);
  float backlit = heightNorm * thinness
                * pow(clamp(dot(L, -V), 0.0, 1.0), 4.0)
                * pow(0.5 - 0.5 * dot(L, N), 3.0);
  vec3 scatter = bodyR * sun * backlit * 3.4 / (1.0 + max(0.0, -L.y) * 4.0);

  float sunUp = max(L.y, 0.0);
  vec3 beam = sun * sunUp * (1.0 - fresnelWater(max(sunUp, 1e-3), 0.0)) / PI_S;
  scatter += bodyR * (beam + skyAmb * 0.94);
  scatter += bodyR * bubbles * 0.55 * (skyAmb * 1.6 + sun * 0.10);

  vec3 deep = uWaterAbsorb * skyAmb * 0.8;
  vec3 refracted = scatter + deep;

  vec3 color = mix(refracted, env, F) + spec;

  if (backLit) {
    float thickness = clamp(0.35 + vWaveY * 0.04, 0.15, 1.0);
    vec3 through = (sun * max(L.y, 0.05) * 0.45 + skyAmb * 1.15)
                 * uWaterAbsorb / (1.0 + thickness * 2.0);
    through += bodyR * (sun * 2.2 + skyAmb * 1.8) * thinness;
    through += bodyR * bubbles * skyAmb * 1.4;
    color = mix(through, color, 0.18);
  }

  if (foam > 0.002 || foamThin > 0.002) {
    float foamAO = mix(0.62, 1.0, foamFine);
    vec3 foamAlbedo = vec3(0.93, 0.96, 0.985) * foamAO;
    float wrapNoL = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);
    vec3 foamLit = foamAlbedo * (sun * wrapNoL * 0.30 + skyAmb * 0.95);
    foamLit += foamAlbedo * sun * pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 0.10 * foamFine;
    vec3 fspec = vec3(0.0);
    if (NoL > 0.0) {
      vec3 H = normalize(L + V);
      float NoH = max(dot(N, H), 0.0);
      float aF = 0.55;
      fspec = sun * ggxD(NoH, aF) * smithGGXCorrelated(NoV, max(NoL, 1e-4), aF) * 0.04 * NoL;
    }
    color = mix(color, foamLit + fspec, foam);
    color = mix(color, mix(color, foamLit, 0.20), foamThin * (1.0 - foam));
  }

  color += vec3(rainRip) * sun * 0.02;
  vec3 preLightning = color;

  color += lightningContribution(vWorldPos, N, V, uLightning0, uLightning1, uLightningColor)
         * (0.55 + foam * 1.6);
  color += uAmbientFlash * uLightningColor * (0.02 + foam * 0.35 + F * 0.25);

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec4 ap = sampleAerial(screenUv, vDist);
  vec3 tr = pow(vec3(clamp(ap.a, 0.0, 1.0)), vec3(1.0, 1.06, 1.16));
  color = color * tr + ap.rgb * uSunIntensity;

  if (uDebugMode > 0.5) {
    vec3 dbg = vec3(0.0);
    int m = int(uDebugMode + 0.5);
    if (m == 1) dbg = N * 0.5 + vec3(0.5);
    else if (m == 2) dbg = vec3(foam, foamThin, foamMask * 0.3);
    else if (m == 3) dbg = env * 0.05;
    else if (m == 4) dbg = vec3(F);
    else if (m == 5) dbg = abs(vDisp) * 0.1;
    else if (m == 6) dbg = ap.rgb * uSunIntensity * 0.1;
    else if (m == 7) dbg = vec3(t1.r, t1.g, t1.b);
    else if (m == 8) dbg = vec3(roughness);
    else if (m == 9) dbg = refracted * 0.5;
    else if (m == 10) dbg = spec * 0.02;
    else if (m == 11) dbg = vec3(vLods / 8.0);
    else if (m == 12) dbg = vec3(fract(vDist * 0.001), fract(vDist * 0.01), 0.0);
    else if (m == 13) dbg = preLightning / 3.0;
    else if (m == 14) dbg = (color - preLightning * tr) / 3.0;
    else if (m == 15) dbg = vec3(sun) / 3.0;
    else if (m == 16) dbg = color / 3.0;
    else if (m == 17) dbg = lightningContribution(vWorldPos, N, V, uLightning0, uLightning1, uLightningColor) / 3.0;
    else if (m == 18) dbg = vec3(uAmbientFlash, uLightning0.w, uLightning1.w) / 3.0;
    oColor = vec4(dbg * 3.0, 1.0);
    oVelocity = vec4(0.0, 0.0, vDist, 1.0);
    return;
  }

  oColor = vec4(max(color, vec3(0.0)), 1.0);

  vec2 cur = vClipNJ.xy / max(vClipNJ.w, 1e-6);
  vec2 prv = vPrevClipNJ.xy / max(vPrevClipNJ.w, 1e-6);
  oVelocity = vec4((cur - prv) * 0.5, vDist, foam);
}
`;

export class OceanMesh {
  fft: OceanFFT;
  gridX: number;
  gridY: number;
  uniforms: Record<string, any>;
  material: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  triangles: number;

  constructor(oceanFFT: OceanFFT, atmosphere: Atmosphere, quality: Quality, cloudShared: any = null) {
    this.fft = oceanFFT;
    this.gridX = 0;
    this.gridY = 0;
    this.triangles = 0;

    const uniforms: Record<string, any> = {
      uRMax: { value: 68000.0 },
      uGridSize: { value: new THREE.Vector2(1, 1) },
      uGridMargin: { value: 1.04 },
      uSkirt: { value: 1.1 },
      uGridPlane: { value: 0.0 },
      uEventSteps: { value: 16 },
      uEventBisect: { value: 8 },
      uCurrentStrength: { value: 26.0 },
      uDisplaceScale: { value: 1.0 },
      uCascadeGain: { value: new THREE.Vector3(1, 1, 1) },
      uWaterScatter: { value: new THREE.Vector3(0.018, 0.075, 0.088) },
      uWaterAbsorb: { value: new THREE.Vector3(0.004, 0.021, 0.036) },
      uFoamStrength: { value: 1.0 },
      uUnderwater: { value: 0 },
      uDebugMode: { value: 0 },
      ...U,
    };
    oceanFFT.bind(uniforms);
    atmosphere.bind(uniforms);

    uniforms.uSunDir = U.uSunDir;
    uniforms.uSunColor = U.uSunColor;
    uniforms.uSunIntensity = U.uSunIntensity;
    uniforms.uAtmoTurbidity = U.uAtmoTurbidity;
    uniforms.uAtmoMieG = U.uAtmoMieG;
    uniforms.uAtmoGroundAlbedo = U.uAtmoGroundAlbedo;
    uniforms.uInvViewProjNJ = U.uInvViewProjNJ;

    const cs = cloudShared;
    uniforms.uWeatherMap = cs?.uWeatherMap ?? { value: null };
    uniforms.uWeatherScaleM = cs?.uWeatherScaleM ?? { value: 58000 };
    uniforms.uCoverage = cs?.uCoverage ?? { value: 0 };
    uniforms.uCloudContrast = cs?.uCloudContrast ?? { value: 1.6 };
    uniforms.uCloudDensity = cs?.uCloudDensity ?? { value: 0.6 };
    uniforms.uCloudBottom = cs?.uCloudBottom ?? { value: 1200 };
    uniforms.uCloudWind = cs?.uCloudWind ?? { value: new THREE.Vector2() };
    uniforms.uCloudTime = cs?.uCloudTime ?? { value: 0 };

    this.uniforms = uniforms;
    this.material = new THREE.RawShaderMaterial({
      name: 'OceanSurface',
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.setResolution(quality.oceanGridX, quality.oceanGridY);
  }

  setResolution(gridX: number, gridY: number) {
    gridX = Math.max(16, gridX | 0); gridY = Math.max(12, gridY | 0);
    if (this.gridX === gridX && this.gridY === gridY) return;
    this.gridX = gridX; this.gridY = gridY;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildProjectedGrid(gridX, gridY);
    if (old) old.dispose();
    this.uniforms.uGridSize.value.set(gridX, gridY);
    this.triangles = gridX * gridY * 2;
  }

  update(camPos: THREE.Vector3, surfaceY = 0) {
    this.uniforms.uUnderwater.value = camPos.y < surfaceY ? 1 : 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
