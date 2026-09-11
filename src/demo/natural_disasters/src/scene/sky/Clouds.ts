import * as THREE from 'three';
import { U } from '../core/SharedUniforms';
import { FullScreenPass, makeRT, PingPong } from '../gfx/FullScreenPass';
import { ATMO_COMMON } from './AtmosphereGLSL';
import { SHADING_GLSL } from '../gfx/ShadingGLSL';
import { NOISE_GLSL } from '../gfx/NoiseGLSL';
import { Atmosphere } from './Atmosphere';
import { Quality } from '../core/Quality';
import { BakedTextures } from '../gfx/ProceduralTextures';

const PROBE_NDC = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

const CLOUD_COMMON = /* glsl */ `
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;
uniform sampler2D uCurlTex;
uniform sampler2D uWeatherMap;
uniform float uWeatherScaleM;
uniform vec4 uShapeLo;
uniform vec4 uShapeHi;
uniform vec4 uDetailLo;
uniform vec4 uDetailHi;

uniform float uCoverage;
uniform float uCloudDensity;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform float uAnvil;
uniform float uStorm;
uniform vec2  uCloudWind;
uniform float uCloudTime;
uniform float uCloudScaleM;
uniform float uCloudAspect;
uniform float uCloudContrast;
uniform float uSunIntensity;
uniform vec3  uSunDir;
uniform float uAmbientFlash;

vec3 gAmbTop = vec3(0.0);
vec3 gAmbBottom = vec3(0.0);
uniform vec3  uLightningColor;
uniform vec4  uLightning0;
uniform vec4  uLightning1;

const float PLANET_R = 6360000.0;

float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) * (d - c) / max(b - a, 1e-5);
}

vec4 shapeTex(vec3 uvw) {
  return clamp((textureLod(uCloudShape, uvw, 0.0) - uShapeLo) / (uShapeHi - uShapeLo), 0.0, 1.0);
}
vec4 detailTex(vec3 uvw) {
  return clamp((textureLod(uCloudDetail, uvw, 0.0) - uDetailLo) / (uDetailHi - uDetailLo), 0.0, 1.0);
}

float heightProfile(float h, float type) {
  float t = clamp(type * 2.0, 0.0, 1.0);
  float rise = mix(0.05, 0.13, t);
  float fallFrom = mix(0.16, 0.48, t);
  float fallTo = mix(0.38, 0.95, t);
  float lo = smoothstep(0.0, rise, h) * (1.0 - smoothstep(fallFrom, fallTo, h));

  float tower = smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.88, 1.0, h));
  float anvil = smoothstep(0.58, 0.74, h) * (1.0 - smoothstep(0.90, 1.0, h));
  float cb = max(tower * 0.9, anvil);

  return mix(lo, cb, clamp(type * 2.0 - 1.0, 0.0, 1.0));
}

vec3 weatherAt(vec2 xz) {
  vec2 w = xz + uCloudWind * uCloudTime * 0.6;
  vec4 m = textureLod(uWeatherMap, w / uWeatherScaleM, 0.0);
  vec4 n = textureLod(uWeatherMap, w / (uWeatherScaleM * 0.27)
                 + vec2(0.37, 0.11) - uCloudWind * uCloudTime * 0.00002, 0.0);

  float field = m.r * 0.62 + m.g * 0.22 + n.g * 0.16;
  float cover = clamp((field - 0.5) * uCloudContrast + uCoverage, 0.0, 1.0)
              * smoothstep(0.0, 0.05, uCoverage);
  float type = clamp(0.30 + 0.20 * m.b + uAnvil * (0.34 + 0.55 * m.b + 0.6 * m.a), 0.0, 1.0);
  float lift = (n.r * 0.6 + m.g * 0.4 - 0.5) * 0.34;
  return vec3(cover, type, lift);
}

float gShapeR = 0.0;
float gBase = 0.0;
float gT0 = 0.0, gT1 = 0.0, gIters = 0.0, gSpent = 0.0, gCov = 0.0;

float cloudDensity(vec3 p, float h, float detail) {
  vec3 q = p;
  q.xz += uCloudWind * uCloudTime * (0.6 + h * 1.5);

  vec3 wm = weatherAt(q.xz);
  float type = wm.y;
  float anvilness = smoothstep(0.62, 1.0, type);
  float cov = mix(wm.x, min(wm.x * 1.8 + 0.24, 1.0), smoothstep(0.55, 0.88, h) * anvilness);
  gCov = max(gCov, cov);
  if (cov <= 0.01) return 0.0;

  float hs = h - wm.z;
  if (hs <= 0.0 || hs >= 1.0) return 0.0;

  vec3 uvw = q / uCloudScaleM;
  uvw.y *= uCloudAspect;
  vec3 warp = (detailTex(uvw * 11.0).rgb - vec3(0.5)) * 0.011;
  vec4 shape = shapeTex(uvw + warp);

  float fbmLow = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
  float base = remap(shape.r, fbmLow * 0.92 - 1.0, 1.0, 0.0, 1.0);
  base *= heightProfile(hs, type);
  gShapeR = max(gShapeR, shape.r);
  gBase = max(gBase, base);

  float d = remap(base, mix(0.99, 0.20, pow(cov, 0.67)), 1.0, 0.0, 1.0);
  if (d <= 0.0) return 0.0;

  d = d * d * (3.0 - 2.0 * d);

  float w1 = clamp(detail, 0.0, 1.0);
  if (w1 > 0.001) {
    vec2 curl = textureLod(uCurlTex, uvw.xz * 3.1, 0.0).rg * 2.0 - 1.0;
    vec3 dp = q / (uCloudScaleM * 0.2);
    dp.xz += curl * (1.0 - h) * 3.5;
    vec3 det = detailTex(dp).rgb;
    float detFbm = det.r * 0.625 + det.g * 0.25 + det.b * 0.125;
    float mod3 = mix(1.0 - detFbm, detFbm, clamp(h * 4.0, 0.0, 1.0));
    float bite = mix(0.78, 0.14, smoothstep(0.20, 0.78, d));
    d = mix(d, remap(d, mod3 * bite, 1.0, 0.0, 1.0), w1);
    if (d <= 0.0) return 0.0;

    float w2 = clamp(detail - 1.0, 0.0, 1.0);
    if (w2 > 0.001) {
      vec3 fp = dp * 3.1;
      fp.xz += curl * 0.9;
      vec3 fine = detailTex(fp).rgb;
      float f = fine.r * 0.62 + fine.g * 0.26 + fine.b * 0.12;
      float fbite = mix(0.46, 0.08, smoothstep(0.25, 0.85, d));
      d = mix(d, remap(d, f * fbite, 1.0, 0.0, 1.0), w2);
      if (d <= 0.0) return 0.0;
    }
  }

  return clamp(d, 0.0, 1.0) * uCloudDensity;
}

vec2 shellIntersect(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

vec3 applyAerial(vec3 scatter, float transmittance, float dist, vec3 hazeColor) {
  if (dist <= 0.0) return scatter;
  vec3 beta = (vec3(5.802e-6, 13.558e-6, 33.1e-6)
             + vec3(3.996e-6) * uAtmoTurbidity) * 0.72;
  vec3 Ta = exp(-beta * dist);
  return scatter * Ta + hazeColor * (1.0 - Ta) * (1.0 - transmittance);
}

vec3 lightningGlow(vec3 p) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec4 l = (i == 0) ? uLightning0 : uLightning1;
    if (l.w <= 0.0001) continue;
    float d2 = dot(l.xyz - p, l.xyz - p);
    sum += uLightningColor * l.w * 6.0e6 / max(d2, 4.0e4);
  }
  return sum;
}
`;

const CLOUD_MARCH = /* glsl */ `
uniform int uSteps;
uniform int uLightSteps;
uniform sampler2D uSkyAmbLUT;
uniform vec3 uDetailFade;

void skyAmbient(vec3 viewPos, vec3 rd) {
  vec3 up = getValFromSkyLUT(uSkyAmbLUT, viewPos, vec3(0.0, 1.0, 0.0), uSunDir);
  vec3 side = getValFromSkyLUT(uSkyAmbLUT, viewPos,
                normalize(vec3(rd.x, 0.07, rd.z)), uSunDir);
  gAmbTop = up * uSunIntensity * 1.45;
  gAmbBottom = (side * 0.50 + up * 0.15) * uSunIntensity * vec3(0.80, 0.88, 1.0);
}

const float SIGMA = 0.022;

vec3 sampleLight(vec3 p, float mu, vec3 sunColor, float selfDensity, float jitter, int steps) {
  vec3 ld = uSunDir;
  float thickness = uCloudTop - uCloudBottom;
  float stepLen = thickness * 0.045;
  float depth = 0.0;
  float travelled = stepLen * (0.25 + 0.3 * jitter);
  for (int i = 0; i < 8; i++) {
    if (i >= steps) break;
    travelled += stepLen;
    vec3 sp = p + ld * travelled;
    float sh = clamp((length(sp) - (PLANET_R + uCloudBottom)) / thickness, 0.0, 1.0);
    depth += cloudDensity(sp, sh, 0.0) * stepLen;
    stepLen *= 1.62;
  }

  vec3 lum = vec3(0.0);
  float a = 1.0, b = 1.0, c = 1.0;
  for (int o = 0; o < 3; o++) {
    float beer = exp(-depth * SIGMA * b);
    float powder = 1.0 - exp(-selfDensity * 14.0);
    float phase = dualHG(mu, 0.82 * c, -0.32 * c, 0.55);
    lum += sunColor * a * phase * beer * mix(1.0, powder, 0.6);
    a *= 0.5; b *= 0.42; c *= 0.68;
  }
  return lum;
}

vec4 marchClouds(vec3 ro, vec3 rd, float rayJitter, vec3 sunColor, out vec4 diag) {
  diag = vec4(-1.0, 0.0, 0.0, 0.0);
  float depthOut = -1.0;
  float peakDensity = 0.0;
  vec3 center = vec3(0.0, -PLANET_R, 0.0);
  vec3 o = ro - center;

  float thickness = uCloudTop - uCloudBottom;
  float rInner = PLANET_R + uCloudBottom;
  float rOuter = PLANET_R + uCloudTop;
  vec2 tOuter = shellIntersect(o, rd, rOuter);
  if (tOuter.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 tInner = shellIntersect(o, rd, rInner);

  float t0, t1;
  float ro_r = length(o);
  if (ro_r < rInner) {
    if (tInner.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    t0 = tInner.y; t1 = tOuter.y;
  } else if (ro_r < rOuter) {
    t0 = 0.0;
    t1 = (tInner.x > 0.0) ? tInner.x : tOuter.y;
  } else {
    t0 = max(tOuter.x, 0.0);
    t1 = (tInner.x > 0.0) ? tInner.x : tOuter.y;
  }
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);

  float maxDist = 140000.0;
  t1 = min(t1, t0 + maxDist);
  gT0 = t0; gT1 = t1;

  float nearFine = clamp(thickness * 0.005, 22.0, 48.0);
  float mu = dot(rd, uSunDir);
  vec3 scatter = vec3(0.0);
  float transmittance = 1.0;

  float t = t0 + nearFine * rayJitter;
  bool inside = false;
  int emptyRun = 0;
  int spent = 0;

  for (int i = 0; i < 512; i++) {
    gIters = float(i);
    if (spent >= uSteps || t > t1 || transmittance < 0.004) break;
    float budget = float(uSteps - spent) / float(uSteps);
    float fine = nearFine * clamp(1.0 + t / 9000.0, 1.0, 22.0)
               * (1.0 + 7.0 * (1.0 - smoothstep(0.0, 0.35, budget)));
    float stride = fine * 3.0;
    vec3 p = o + rd * t;
    float h = clamp((length(p) - rInner) / thickness, 0.0, 1.0);

    if (!inside) {
      if (cloudDensity(p, h, 0.0) > 0.0) {
        t = max(t - stride + fine * rayJitter, t0);
        inside = true;
        emptyRun = 0;
      } else {
        t += stride;
      }
      continue;
    }

    float detail = 2.0 - smoothstep(uDetailFade.x, uDetailFade.y, t)
                       - smoothstep(uDetailFade.y, uDetailFade.z, t);
    float dens = cloudDensity(p, h, detail);
    peakDensity = max(peakDensity, dens);
    spent++;
    if (dens > 0.0005) {
      diag.w += 1.0;
      emptyRun = 0;
      if (depthOut < 0.0) depthOut = t;

      int ls = transmittance > 0.25 ? uLightSteps : 2;
      vec3 lum = sampleLight(p, mu, sunColor, dens, rayJitter, ls);

      float above = 0.0;
      {
        float span = max(uCloudTop - uCloudBottom, 200.0);
        vec3 up = normalize(p);
        above += cloudDensity(p + up * span * 0.10, min(h + 0.10, 1.0), 0.0) * span * 0.22;
        above += cloudDensity(p + up * span * 0.34, min(h + 0.34, 1.0), 0.0) * span * 0.46;
      }
      float skyVis = exp(-above * SIGMA * 0.55);

      vec3 amb = mix(gAmbBottom, gAmbTop, h);
      lum += amb * mix(0.55, 1.0, h) * mix(0.16, 1.0, skyVis);
      lum += lightningGlow(p + center);
      lum += uAmbientFlash * uLightningColor * 0.25;

      float tr = exp(-dens * SIGMA * fine);
      scatter += lum * transmittance * (1.0 - tr);
      transmittance *= tr;
    } else if (++emptyRun > 4) {
      inside = false;
    }
    t += fine;
  }

  diag.x = depthOut;
  diag.y = gShapeR;
  diag.z = max(gBase, peakDensity);
  gSpent = float(spent);
  return vec4(scatter, transmittance);
}
`;

const CLOUD_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec2 uLowRes;
uniform vec2 uSlotOffset;
uniform float uFrame;
uniform int uCloudDebug;

${ATMO_COMMON}
${SHADING_GLSL}
${NOISE_GLSL}
${CLOUD_COMMON}
${CLOUD_MARCH}

uniform sampler2D uTransmittanceLUT;
uniform sampler2D uSkyViewLUT;

in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDepth;

void main(){
  vec2 lowPix = floor(gl_FragCoord.xy) * 4.0 + uSlotOffset + vec2(0.5);
  vec2 uv = lowPix / uLowRes;

  vec2 ndc = uv * 2.0 - 1.0;
  vec4 p0 = uInvViewProj * vec4(ndc, -1.0, 1.0); p0 /= p0.w;
  vec4 p1 = uInvViewProj * vec4(ndc,  1.0, 1.0); p1 /= p1.w;
  vec3 rd = normalize(p1.xyz - p0.xyz);

  float dip = -sqrt(2.0 * max(uCamPos.y, 0.0) / 6360000.0) - 0.003;
  if (rd.y < dip) {
    oColor = vec4(0.0, 0.0, 0.0, 1.0);
    oDepth = vec4(-1.0, 0.0, 0.0, 0.0);
    return;
  }

  vec3 viewPos = vec3(0.0, groundRadiusMM + max(uCamPos.y, 0.2) * 1e-6, 0.0);
  vec3 sunColor = getValFromTLUT(uTransmittanceLUT, viewPos, uSunDir) * uSunIntensity;
  skyAmbient(viewPos, rd);

  vec4 diag;
  float cycle = floor(uFrame * 0.0625);
  vec4 cl = marchClouds(uCamPos, rd, fract(bayer4(lowPix) + 0.6180339887 * cycle),
                        sunColor, diag);

  vec3 haze = getValFromSkyLUT(uSkyViewLUT, viewPos, rd, uSunDir) * uSunIntensity;
  cl.rgb = applyAerial(cl.rgb, cl.a, diag.x, haze);

  if (uCloudDebug > 0) {
    vec3 v = (uCloudDebug == 1)
      ? vec3(gT0 / 40000.0, gIters / 512.0, gCov)
      : vec3(gSpent / float(uSteps), diag.z, diag.x / 60000.0);
    oColor = vec4(clamp(v, 0.0, 1.0), 1.0);
    oDepth = diag;
    return;
  }

  oColor = cl;
  oDepth = diag;
}
`;

const CLOUD_REPROJ_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uQuarter;
uniform sampler2D uQuarterDiag;
uniform sampler2D uHistory;
uniform sampler2D uHistoryDiag;
uniform mat4 uPrevViewProj;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec2 uSlotOffset;
uniform float uReset;
uniform float uBlend;
uniform float uShellMid;
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDiag;

void main(){
  ivec2 lp = ivec2(gl_FragCoord.xy);
  ivec2 qp = lp >> 2;
  ivec2 slot = ivec2(uSlotOffset);
  bool fresh = (lp.x & 3) == slot.x && (lp.y & 3) == slot.y;

  vec4 cur = texelFetch(uQuarter, qp, 0);
  vec4 curDiag = texelFetch(uQuarterDiag, qp, 0);

  vec4 smooth_ = texture(uQuarter, vUv);
  vec4 smoothDiag = texture(uQuarterDiag, vUv);

  if (uReset > 0.5) {
    oColor = fresh ? cur : smooth_;
    oDiag = fresh ? curDiag : smoothDiag;
    return;
  }

  float dist = texture(uHistoryDiag, vUv).x;
  if (dist <= 0.0) dist = uShellMid;

  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 p0 = uInvViewProj * vec4(ndc, -1.0, 1.0); p0 /= p0.w;
  vec4 p1 = uInvViewProj * vec4(ndc,  1.0, 1.0); p1 /= p1.w;
  vec3 rd = normalize(p1.xyz - p0.xyz);
  vec4 prevClip = uPrevViewProj * vec4(uCamPos + rd * dist, 1.0);
  vec2 prevUv = (prevClip.xy / max(prevClip.w, 1e-6)) * 0.5 + vec2(0.5);

  if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) {
    oColor = fresh ? cur : smooth_;
    oDiag = fresh ? curDiag : smoothDiag;
    return;
  }

  vec4 hist = texture(uHistory, prevUv);
  vec4 histDiag = texture(uHistoryDiag, prevUv);

  vec4 lo = cur, hi = cur;
  ivec2 qmax = textureSize(uQuarter, 0) - 1;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec4 s = texelFetch(uQuarter, clamp(qp + ivec2(x, y), ivec2(0), qmax), 0);
    lo = min(lo, s); hi = max(hi, s);
  }
  vec4 tol = (hi - lo) * 1.5 + vec4(0.06, 0.06, 0.06, 0.12);
  hist = clamp(hist, lo - tol, hi + tol);

  if (fresh) {
    oColor = mix(hist, cur, uBlend);
    oDiag = curDiag;
  } else {
    oColor = hist;
    oDiag = histDiag;
  }
}
`;

const CLOUD_UPSAMPLE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uInvSrc;
uniform vec2 uSrcRes;
uniform float uSharpen;
in vec2 vUv;
layout(location = 0) out vec4 oColor;

vec4 bicubic(vec2 uv) {
  vec2 pos = uv * uSrcRes - vec2(0.5);
  vec2 base = floor(pos);
  vec2 f = pos - base;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = f2 - 0.5 * (f3 + f);
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w3 = 0.5 * (f3 - f2);
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 t0 = (base - vec2(0.5) + w1 / s0) * uInvSrc;
  vec2 t1 = (base + vec2(1.5) + w3 / s1) * uInvSrc;
  return texture(uSrc, vec2(t0.x, t0.y)) * (s0.x * s0.y)
       + texture(uSrc, vec2(t1.x, t0.y)) * (s1.x * s0.y)
       + texture(uSrc, vec2(t0.x, t1.y)) * (s0.x * s1.y)
       + texture(uSrc, vec2(t1.x, t1.y)) * (s1.x * s1.y);
}

void main(){
  vec4 c = bicubic(vUv);
  if (uSharpen > 0.002) {
    vec2 corner = (floor(vUv / uInvSrc - vec2(0.5)) + vec2(1.0)) * uInvSrc;
    vec4 wide = texture(uSrc, corner + vec2(-1.0, -1.0) * uInvSrc)
              + texture(uSrc, corner + vec2( 1.0, -1.0) * uInvSrc)
              + texture(uSrc, corner + vec2(-1.0,  1.0) * uInvSrc)
              + texture(uSrc, corner + vec2( 1.0,  1.0) * uInvSrc);
    c = mix(c, wide * 0.25, uSharpen);
  }
  oColor = c;
}
`;

const CLOUD_ENV_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

uniform vec3 uCamPos;
uniform float uFrame;

${ATMO_COMMON}
${SHADING_GLSL}
${NOISE_GLSL}
${CLOUD_COMMON}
${CLOUD_MARCH}

uniform sampler2D uTransmittanceLUT;
uniform sampler2D uSkyViewLUT;

in vec2 vUv;
layout(location = 0) out vec4 oColor;

void main(){
  vec3 rd = equirectToDir(vUv);
  if (rd.y < -0.02) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec3 viewPos = vec3(0.0, groundRadiusMM + max(uCamPos.y, 0.2) * 1e-6, 0.0);
  vec3 sunColor = getValFromTLUT(uTransmittanceLUT, viewPos, uSunDir) * uSunIntensity;
  skyAmbient(viewPos, rd);

  vec4 diag;
  vec4 cl = marchClouds(uCamPos, rd, hash12(gl_FragCoord.xy + vec2(uFrame)), sunColor, diag);
  vec3 haze = getValFromSkyLUT(uSkyViewLUT, viewPos, rd, uSunDir) * uSunIntensity;
  cl.rgb = applyAerial(cl.rgb, cl.a, diag.x, haze);
  oColor = cl;
}
`;

export class Clouds {
  renderer: THREE.WebGLRenderer;
  atmosphere: Atmosphere;
  enabled: boolean;
  frame: number;
  reset: boolean;
  forceReset: boolean;
  scale: number;
  slots: [number, number][];
  shared: Record<string, any>;
  marchPass: FullScreenPass;
  reprojPass: FullScreenPass;
  upsamplePass: FullScreenPass;
  envPass: FullScreenPass;

  private _blockHide: number;
  envSize: number;
  envRT: THREE.WebGLRenderTarget | null;
  fullW: number;
  fullH: number;
  lowW: number;
  lowH: number;

  quarterRT: THREE.WebGLRenderTarget | null;
  history: PingPong | null;
  fullRT: THREE.WebGLRenderTarget | null;

  constructor(renderer: THREE.WebGLRenderer, atmosphere: Atmosphere, textures: Partial<BakedTextures>, quality: Quality) {
    this.renderer = renderer;
    this.atmosphere = atmosphere;
    this.enabled = true;
    this.frame = 0;
    this.reset = true;
    this.forceReset = false;
    this.scale = 0.5;
    this._blockHide = 0;
    this.envRT = null;
    this.quarterRT = null;
    this.history = null;
    this.fullRT = null;
    this.fullW = 0;
    this.fullH = 0;
    this.lowW = 0;
    this.lowH = 0;
    this.envSize = 128;

    const pct = (tex: any) => {
      const p = tex?.userData?.percentiles;
      return p
        ? [new THREE.Vector4(...p.lo), new THREE.Vector4(...p.hi)]
        : [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(1, 1, 1, 1)];
    };
    const [shapeLo, shapeHi] = pct(textures.cloudShape);
    const [detLo, detHi] = pct(textures.cloudDetail);

    this.shared = {
      uCloudShape: { value: textures.cloudShape },
      uCloudDetail: { value: textures.cloudDetail },
      uShapeLo: { value: shapeLo }, uShapeHi: { value: shapeHi },
      uDetailLo: { value: detLo }, uDetailHi: { value: detHi },
      uCurlTex: U.uCurlTex,
      uWeatherMap: { value: textures.weatherMap },
      uWeatherScaleM: { value: 58000 },
      uCoverage: { value: 0.4 },
      uCloudDensity: { value: 0.6 },
      uCloudBottom: { value: 1200 },
      uCloudTop: { value: 5200 },
      uAnvil: { value: 0.0 },
      uStorm: U.uStormFactor,
      uCloudWind: { value: new THREE.Vector2(6, 2) },
      uCloudTime: { value: 0 },
      uCloudScaleM: { value: 15000 },
      uCloudAspect: { value: 2.6 },
      uCloudContrast: { value: 1.6 },
      uSunIntensity: U.uSunIntensity,
      uSunDir: U.uSunDir,
      uSkyAmbLUT: { value: atmosphere.skyViewRT.texture },
      uAmbientFlash: U.uAmbientFlash,
      uLightningColor: U.uLightningColor,
      uLightning0: U.uLightning0,
      uLightning1: U.uLightning1,
      uTransmittanceLUT: { value: atmosphere.transmittanceRT.texture },
      uSkyViewLUT: { value: atmosphere.skyViewRT.texture },
      uAtmoTurbidity: U.uAtmoTurbidity,
      uAtmoMieG: U.uAtmoMieG,
      uAtmoGroundAlbedo: U.uAtmoGroundAlbedo,
      uSteps: { value: 64 },
      uLightSteps: { value: 6 },
    };

    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    this.slots = new Array(16);
    for (let i = 0; i < 16; i++) this.slots[BAYER[i]] = [i % 4, (i / 4) | 0];

    this.marchPass = new FullScreenPass(CLOUD_FRAG, {
      ...this.shared,
      uInvViewProj: U.uInvViewProjNJ,
      uCamPos: U.uCamPos,
      uLowRes: { value: new THREE.Vector2(1, 1) },
      uSlotOffset: { value: new THREE.Vector2() },
      uFrame: U.uFrame,
      uDetailFade: { value: new THREE.Vector3(9000, 34000, 95000) },
      uCloudDebug: { value: 0 },
    }, { name: 'cloudMarch' });

    this.reprojPass = new FullScreenPass(CLOUD_REPROJ_FRAG, {
      uQuarter: { value: null }, uQuarterDiag: { value: null },
      uHistory: { value: null }, uHistoryDiag: { value: null },
      uPrevViewProj: U.uPrevViewProjNJ, uInvViewProj: U.uInvViewProjNJ,
      uCamPos: U.uCamPos, uSlotOffset: { value: new THREE.Vector2() },
      uReset: { value: 1 }, uBlend: { value: 0.4 },
      uShellMid: { value: 20000 },
    }, { name: 'cloudReproj' });

    this.upsamplePass = new FullScreenPass(CLOUD_UPSAMPLE_FRAG, {
      uSrc: { value: null }, uInvSrc: { value: new THREE.Vector2() },
      uSrcRes: { value: new THREE.Vector2() },
      uSharpen: { value: 0.0 },
    }, { name: 'cloudUpsample' });

    this.envPass = new FullScreenPass(CLOUD_ENV_FRAG, {
      ...this.shared,
      uCamPos: U.uCamPos,
      uFrame: U.uFrame,
      uSteps: { value: 18 },
      uLightSteps: { value: 3 },
      uDetailFade: { value: new THREE.Vector3(1500, 4000, 12000) },
    }, { name: 'cloudEnv' });

    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    this.scale = q.cloudScale;
    this.enabled = q.cloudEnabled;
    this.marchPass.uniforms.uSteps.value = q.cloudSteps;
    this.marchPass.uniforms.uLightSteps.value = q.cloudLightSteps;
    this.envPass.uniforms.uSteps.value = q.envCloudSteps;
    this.envSize = Math.max(64, Math.floor(q.envSize / 2));
    if (this.envRT && this.envRT.width !== this.envSize) {
      this.envRT.dispose();
      this.envRT = null;
    }
    if (!this.envRT) {
      this.envRT = makeRT(this.envSize, this.envSize / 2, {
        type: THREE.HalfFloatType, name: 'cloudEnv', wrap: THREE.RepeatWrapping,
      });
      this.envRT.texture.wrapS = THREE.RepeatWrapping;
      this.envRT.texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    if (this.fullW) this.setSize(this.fullW, this.fullH, true);
  }

  setSize(w: number, h: number, force = false) {
    const lw = Math.max(16, Math.ceil(w * this.scale / 4) * 4);
    const lh = Math.max(16, Math.ceil(h * this.scale / 4) * 4);
    if (!force && this.lowW === lw && this.lowH === lh) return;
    this.fullW = w; this.fullH = h;
    this.lowW = lw; this.lowH = lh;

    this.quarterRT?.dispose();
    this.history?.dispose();
    this.fullRT?.dispose();

    this.quarterRT = makeRT(lw / 4, lh / 4, {
      type: THREE.HalfFloatType, count: 2, name: 'cloudQuarter',
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.history = new PingPong(lw, lh, { type: THREE.HalfFloatType, count: 2, name: 'cloudHist' });
    this.fullRT = makeRT(w, h, { type: THREE.HalfFloatType, name: 'cloudFull' });
    this.marchPass.uniforms.uLowRes.value.set(lw, lh);
    this.reset = true;
  }

  private _reprojectionShift(dist: number) {
    const inv = U.uInvViewProjNJ.value;
    const prev = U.uPrevViewProjNJ.value;
    const cam = U.uCamPos.value;
    let worst = 0;
    for (const p of PROBE_NDC) {
      _pa.set(p[0], p[1], -1).applyMatrix4(inv);
      _pb.set(p[0], p[1], 1).applyMatrix4(inv);
      _pb.sub(_pa).normalize().multiplyScalar(dist).add(cam).applyMatrix4(prev);
      if (!Number.isFinite(_pb.x) || !Number.isFinite(_pb.y)) return 1e3;
      const du = (_pb.x - p[0]) * 0.5 * this.lowW;
      const dv = (_pb.y - p[1]) * 0.5 * this.lowH;
      worst = Math.max(worst, Math.hypot(du, dv));
    }
    return worst;
  }

  update(time: number, dt: number) {
    if (!this.enabled || !this.quarterRT || !this.history || !this.fullRT) return;
    const r = this.renderer;
    const s = this.shared;
    s.uCloudTime.value = time;

    const thickness = Math.max(s.uCloudTop.value - s.uCloudBottom.value, 200);
    s.uCloudAspect.value = THREE.MathUtils.clamp(
      s.uCloudScaleM.value / (thickness * 4.4), 0.8, 1.7);

    const slot = this.slots[this.frame % 16];
    this.marchPass.uniforms.uSlotOffset.value.set(slot[0], slot[1]);
    this.reprojPass.uniforms.uSlotOffset.value.set(slot[0], slot[1]);
    this.frame++;

    this.marchPass.render(r, this.quarterRT);

    const mid = (s.uCloudBottom.value + s.uCloudTop.value) * 0.5;
    this.reprojPass
      .set('uQuarter', this.quarterRT.textures[0])
      .set('uQuarterDiag', this.quarterRT.textures[1])
      .set('uHistory', this.history.read.textures[0])
      .set('uHistoryDiag', this.history.read.textures[1])
      .set('uReset', (this.reset || this.forceReset) ? 1 : 0)
      .set('uShellMid', Math.max(mid, 500) * 6.0);
    this.reprojPass.render(r, this.history.write);
    this.history.swap();

    const shift = this._reprojectionShift(Math.max(mid, 500) * 6.0);
    const want = THREE.MathUtils.clamp((shift - 0.3) / 1.8, 0, 1);
    this._blockHide += (want - this._blockHide) * (want > this._blockHide ? 0.55 : 0.045);

    this.upsamplePass.set('uSrc', this.history.read.textures[0]);
    this.upsamplePass.set('uSharpen', this._blockHide * 0.85);
    this.upsamplePass.uniforms.uInvSrc.value.set(1 / this.lowW, 1 / this.lowH);
    this.upsamplePass.uniforms.uSrcRes.value.set(this.lowW, this.lowH);
    this.upsamplePass.render(r, this.fullRT);

    if (this.envRT && (this.frame % 8 === 0 || this.reset)) this.envPass.render(r, this.envRT);

    this.reset = false;
  }

  get screenTexture(): THREE.Texture | null { return (this.enabled && this.fullRT) ? this.fullRT.texture : null; }
  get envTexture(): THREE.Texture | null { return (this.enabled && this.envRT) ? this.envRT.texture : null; }

  dispose() {
    this.quarterRT?.dispose(); this.history?.dispose();
    this.fullRT?.dispose(); this.envRT?.dispose();
  }
}
