import * as THREE from 'three';
import { U } from '../core/SharedUniforms';
import { FullScreenPass, makeRT } from '../gfx/FullScreenPass';
import { ATMO_COMMON } from './AtmosphereGLSL';
import { SHADING_GLSL } from '../gfx/ShadingGLSL';
import { NOISE_GLSL } from '../gfx/NoiseGLSL';
import { Atmosphere } from './Atmosphere';
import { createNoiseTexture } from './noise-texture';

const SKY_CORE = /* glsl */ `
uniform sampler2D uSkyViewLUT;
uniform sampler2D uTransmittanceLUT;
uniform sampler2D tNoiseMap;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uStarIntensity;
uniform float uAmbientFlash;
uniform vec3 uLightningColor;
uniform vec4 uLightning0;
uniform vec4 uLightning1;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uTimeStars;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform vec2 uWindDrift;
uniform float uStormFactor;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform float uRain;
uniform float uFogDensity;

const float SUN_ANGULAR_RADIUS = 0.00465;
const float NOISE_TEXTURE_SIZE = 512.0;

vec3 sunDisc(vec3 dir, vec3 sunDir, vec3 transmittance) {
  float cosT = dot(dir, sunDir);
  float ang = acos(clamp(cosT, -1.0, 1.0));
  if (ang > SUN_ANGULAR_RADIUS * 2.2) return vec3(0.0);
  float r = clamp(ang / SUN_ANGULAR_RADIUS, 0.0, 1.0);
  float mu = sqrt(max(1.0 - r * r, 0.0));
  vec3 u = vec3(1.0);
  vec3 a = vec3(0.397, 0.503, 0.652);
  vec3 factor = 1.0 - u * (1.0 - pow(vec3(mu), a));
  float edge = 1.0 - smoothstep(1.0, 1.45, ang / SUN_ANGULAR_RADIUS);
  return transmittance * factor * edge * 18000.0;
}

vec3 proceduralSkyFallback(vec3 dir, vec3 sunDir) {
  float elevation = max(dir.y, 0.0);
  float horizon = pow(1.0 - elevation, 4.0);
  vec3 horizonColor = vec3(0.35, 0.55, 0.75);
  vec3 zenithColor = vec3(0.06, 0.18, 0.42);
  vec3 color = mix(horizonColor, zenithColor, smoothstep(0.0, 0.85, elevation));
  color += vec3(0.04, 0.06, 0.08) * horizon;
  return color;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + vec2(45.32));
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (i + f + 0.5) / NOISE_TEXTURE_SIZE;
  return texture(tNoiseMap, uv, -0.65).r;
}

float directionalFbm(vec3 direction, float scale, vec3 offset) {
  vec3 weights = pow(abs(direction), vec3(4.0));
  weights /= max(weights.x + weights.y + weights.z, 0.0001);
  vec3 p = direction * scale + offset;
  float value = 0.0;
  float amplitude = 0.5;

  for (int i = 0; i < 5; i++) {
    vec3 samples = vec3(
      valueNoise(p.yz + vec2(13.7, -4.1)),
      valueNoise(p.xz + vec2(-8.3, 17.2)),
      valueNoise(p.xy + vec2(5.9, 11.4))
    );
    value += dot(samples, weights) * amplitude;
    p = p * 2.03 + vec3(7.1, -9.4, 13.6);
    amplitude *= 0.5;
  }

  return value;
}

vec3 starField(vec3 dir, float intensity) {
  if (intensity < 0.001) return vec3(0.0);
  vec3 col = vec3(0.0);
  for (int oct = 0; oct < 2; oct++) {
    float scale = (oct == 0) ? 340.0 : 780.0;
    vec3 p = dir * scale;
    vec3 i = floor(p);
    vec3 f = fract(p) - vec3(0.5);
    vec3 h = hash33(i);
    if (h.x > (oct == 0 ? 0.982 : 0.9955)) {
      vec3 off = (hash33(i + vec3(7.31)) - vec3(0.5)) * 0.7;
      float d = length(f - off);
      float mag = pow(h.y, 3.0);
      float twinkle = 0.75 + 0.25 * sin(h.z * 90.0 + uTimeStars * (1.2 + h.z * 2.5));
      float s = exp(-d * d * 900.0) * mag * twinkle;
      vec3 tint = mix(vec3(0.68, 0.78, 1.0), vec3(1.0, 0.82, 0.62), h.z);
      col += tint * s;
    }
  }
  float band = exp(-pow(dot(normalize(dir), normalize(vec3(0.42, 0.28, -0.86))) * 2.6, 2.0));
  float mw = directionalFbm(dir, 3.2, vec3(0.0));
  col += vec3(0.55, 0.62, 0.86) * band * mw * 0.055;
  return col * intensity * 8.0;
}
`;

const SKY_PROCEDURAL_CLOUDS = /* glsl */ `
vec3 renderSkyAndClouds(vec3 dir, vec3 camPos) {
  vec3 viewPos = vec3(0.0, groundRadiusMM + max(camPos.y, 0.2) * 1e-6, 0.0);
  vec3 atmoLum = getValFromSkyLUT(uSkyViewLUT, viewPos, dir, uSunDir);
  vec3 tr = getValFromTLUT(uTransmittanceLUT, viewPos, dir);

  if (length(atmoLum) < 0.001) {
    atmoLum = proceduralSkyFallback(dir, uSunDir);
  }

  // Scale atmosphere scattering by sun intensity (standard in Bruneton/Hillaire models)
  vec3 baseSky = atmoLum * uSunIntensity;

  // Sun disc and forward glare
  float sunDot = dot(dir, uSunDir);
  if (dir.y > -0.02) {
    baseSky += sunDisc(dir, uSunDir, tr) * 0.00025 * uSunIntensity;
    float sunForward = max(sunDot, 0.0);
    baseSky += uSunColor * tr * pow(sunForward, 48.0) * 0.35 * uSunIntensity;
  }

  float storm = clamp(uStormFactor, 0.0, 1.0);
  float coverage = clamp(uCloudCoverage + storm * 0.35, 0.05, 0.98);
  float density = clamp(uCloudDensity * (0.85 + storm * 1.8), 0.2, 4.5);

  float sunUp = clamp(uSunDir.y * 5.0 + 0.2, 0.0, 1.0);
  float night = clamp(1.0 - (uSunDir.y + 0.15) * 6.0, 0.0, 1.0);

  // Storm atmosphere darkening (threatening dark slate-gray and indigo)
  vec3 darkStormSky = mix(vec3(0.24, 0.32, 0.44), vec3(0.08, 0.12, 0.18), max(dir.y, 0.0));
  vec3 sky = mix(baseSky, darkStormSky, storm * 0.88);

  // Single-direction unified horizontal wind advection
  vec3 cloudDirection = dir;
  vec3 cloudDrift = vec3(uWindDrift.x, 0.0, uWindDrift.y);

  // High-resolution multi-octave directional triplanar FBM clouds
  float broadCloud = directionalFbm(
    cloudDirection,
    3.4,
    vec3(0.0) + cloudDrift * 0.5
  ) * 0.72 + directionalFbm(
    cloudDirection,
    6.8,
    vec3(-8.7, 4.1, 12.8) + cloudDrift * 0.8
  ) * 0.28;

  float cloudErosion = directionalFbm(
    cloudDirection,
    13.5,
    vec3(19.2, -6.4, 3.7) + cloudDrift * 1.2
  );

  float cloudDetail = directionalFbm(
    cloudDirection,
    27.0,
    vec3(-5.3, 16.8, -11.2) + cloudDrift * 1.6
  );

  float cloudThresholdMin = mix(0.55 - coverage * 0.28, 0.36 - coverage * 0.24, storm);
  float rampWidth = mix(0.14, 0.07, storm) / density;
  float cloud = smoothstep(cloudThresholdMin, cloudThresholdMin + rampWidth, broadCloud);
  cloud *= mix(0.48, 1.0, smoothstep(0.28, 0.68, cloudErosion));
  cloud *= mix(0.72, 1.0, smoothstep(0.25, 0.72, cloudDetail));

  float cloudFade = smoothstep(0.012, 0.14, max(dir.y, 0.0));
  cloud *= cloudFade;

  // Fair weather clouds
  float cloudLight = clamp(dot(dir, uSunDir) * 0.85 + dir.y * 0.55 + 0.42, 0.0, 1.0);
  float forwardScatter = pow(max(sunDot, 0.0), 3.5);
  vec3 fairCloud = mix(vec3(0.38, 0.48, 0.62), vec3(1.15, 1.20, 1.25), cloudLight);
  fairCloud += vec3(1.35, 1.25, 1.02) * forwardScatter * 0.75 * sunUp;

  // Gale / Storm dark clouds (ominous dark charcoal, deep slate, bruised purple-gray)
  vec3 stormCloudDeep = vec3(0.07, 0.09, 0.13);
  vec3 stormCloudMid = vec3(0.16, 0.20, 0.26);
  vec3 stormCloudRim = vec3(0.32, 0.38, 0.48);
  vec3 stormCloud = mix(stormCloudDeep, stormCloudMid, clamp(broadCloud * 0.85 + dir.y * 0.35, 0.0, 1.0));
  stormCloud = mix(stormCloud, stormCloudRim, smoothstep(0.60, 0.95, broadCloud) * 0.4);
  stormCloud = mix(stormCloud, vec3(0.11, 0.14, 0.18), uRain * 0.65);

  vec3 cloudColor = mix(fairCloud * (0.35 + 0.65 * sunUp), stormCloud, storm);

  // Lightning illumination
  float flash = clamp(uAmbientFlash, 0.0, 1.0);
  if (flash > 0.001) {
    vec3 sheetLight = uLightningColor * flash * (3.5 + storm * 4.5);
    cloudColor += sheetLight * (0.28 + 0.72 * cloud);

    float edge = smoothstep(0.15, 0.65, cloud) * (1.0 - smoothstep(0.65, 0.98, cloud));
    cloudColor += uLightningColor * flash * edge * 3.2;

    sky += uLightningColor * flash * 1.85 * (0.35 + 0.65 * exp(-max(dir.y, 0.0) * 3.5));
  }

  float cloudAlpha = cloud * mix(0.85, 0.99, storm);
  sky = mix(sky, cloudColor, cloudAlpha);

  if (night > 0.01) {
    vec3 stars = starField(dir, uStarIntensity * night * (1.0 - storm * 0.95) * (1.0 - cloudAlpha));
    sky += stars * 0.0016 * uSunIntensity;
  }

  return sky;
}
`;

const SKY_DOME_VERT = /* glsl */ `
precision highp float;
precision highp int;

in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec3 vSkyDirection;

void main() {
  vSkyDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_DOME_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

in vec3 vSkyDirection;
layout(location = 0) out vec4 oColor;

${ATMO_COMMON}
${SHADING_GLSL}
${NOISE_GLSL}
${SKY_CORE}
${SKY_PROCEDURAL_CLOUDS}

void main() {
  vec3 dir = normalize(vSkyDirection);
  vec3 col = renderSkyAndClouds(dir, uCamPos);
  oColor = vec4(col, 1.0);
}
`;

const ENV_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 oColor;

${ATMO_COMMON}
${SHADING_GLSL}
${NOISE_GLSL}
${SKY_CORE}
${SKY_PROCEDURAL_CLOUDS}

void main() {
  vec3 dir = equirectToDir(vUv);
  float below = smoothstep(0.0, -0.22, dir.y);
  vec3 lookDir = mix(dir, vec3(dir.x, abs(dir.y) * 0.35 + 0.02, dir.z), below);

  vec3 sky = renderSkyAndClouds(normalize(lookDir), uCamPos);
  sky = mix(sky, sky * vec3(0.16, 0.30, 0.38), below);
  oColor = vec4(sky, 1.0);
}
`;

export class SkyRenderer {
  renderer: THREE.WebGLRenderer;
  atmosphere: Atmosphere;
  starIntensity: number;
  shared: Record<string, any>;
  skyMaterial: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  envRT: THREE.WebGLRenderTarget;
  envPass: FullScreenPass;
  noiseTexture: THREE.DataTexture;
  private _lastTime = -1;
  private _windDrift = new THREE.Vector2(0, 0);

  constructor(renderer: THREE.WebGLRenderer, atmosphere: Atmosphere) {
    this.renderer = renderer;
    this.atmosphere = atmosphere;
    this.starIntensity = 1.0;
    this.noiseTexture = createNoiseTexture();

    this.shared = {
      uSkyViewLUT: { value: atmosphere.skyViewRT.texture },
      uTransmittanceLUT: { value: atmosphere.transmittanceRT.texture },
      tNoiseMap: { value: this.noiseTexture },
      uSunDir: U.uSunDir,
      uMoonDir: U.uMoonDir,
      uSunColor: U.uSunColor,
      uSunIntensity: U.uSunIntensity,
      uCamPos: U.uCamPos,
      uStarIntensity: { value: 1.0 },
      uAmbientFlash: U.uAmbientFlash,
      uLightningColor: U.uLightningColor,
      uLightning0: U.uLightning0,
      uLightning1: U.uLightning1,
      uAtmoTurbidity: U.uAtmoTurbidity,
      uAtmoMieG: U.uAtmoMieG,
      uAtmoGroundAlbedo: U.uAtmoGroundAlbedo,
      uTime: U.uTime,
      uTimeStars: { value: 0 },
      uWindDir: U.uWindDir,
      uWindSpeed: U.uWindSpeed,
      uWindDrift: { value: this._windDrift },
      uStormFactor: U.uStormFactor,
      uCloudCoverage: U.uCloudCoverage,
      uCloudDensity: U.uCloudDensity,
      uRain: U.uRain,
      uFogDensity: U.uFogDensity,
    };

    this.skyMaterial = new THREE.RawShaderMaterial({
      name: 'SkyAtmosphereDome',
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      uniforms: this.shared,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 64, 32), this.skyMaterial);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    this.envRT = makeRT(256, 128, {
      type: THREE.HalfFloatType,
      name: 'envProbe',
      wrap: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      mipmaps: true,
    });
    this.envRT.texture.wrapS = THREE.RepeatWrapping;
    this.envRT.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.envPass = new FullScreenPass(ENV_FRAG, this.shared, { name: 'envProbe' });

    U.uEnvMap.value = this.envRT.texture;
    U.uEnvMaxLod.value = Math.log2(256);
    U.uEnvWidth.value = 256;
  }

  setCloudTextures(_screenTex: THREE.Texture | null, _envTex: THREE.Texture | null) {
    // Retained for backward API compatibility with scene manager loop
  }

  update(time: number, cameraPosition?: THREE.Vector3) {
    const dt = this._lastTime >= 0 ? Math.max(0, Math.min(time - this._lastTime, 0.1)) : 0;
    this._lastTime = time;

    this.shared.uTime.value = time;
    this.shared.uTimeStars.value = time;
    this.shared.uStarIntensity.value = this.starIntensity;

    const windDir = U.uWindDir?.value;
    const ws = U.uWindSpeed?.value ?? 0;
    let nx = 0.8;
    let ny = 0.6;
    if (windDir) {
      const len = windDir.length();
      if (len > 0.001) {
        nx = windDir.x / len;
        ny = windDir.y / len;
      }
    }
    const speed = ws * 0.00075 + 0.0035;
    this._windDrift.x += nx * speed * dt;
    this._windDrift.y += ny * speed * dt;

    if (cameraPosition) {
      this.mesh.position.copy(cameraPosition);
    } else if (U.uCamPos?.value) {
      this.mesh.position.copy(U.uCamPos.value);
    }
  }

  renderEnv() {
    this.envPass.render(this.renderer, this.envRT);
  }
}
