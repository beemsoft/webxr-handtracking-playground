import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { noiseGLSL } from '../ocean/NoiseGLSL';

export const skyGLSL = /* glsl */ `
  uniform sampler2D uSkyMap;
  uniform float uSkyRotation, uStorm, uFlash, uCloudCover, uGolden;
  uniform vec3 uSkySun;
  vec3 atmosphereFiltered(vec3 direction, float blur) {
    direction = normalize(direction);
    vec2 uv = vec2(atan(direction.z, direction.x) / 6.283185307 + 0.5, asin(clamp(direction.y, 0.0, 1.0)) / 3.14159265 + 0.5);
    uv.x += uSkyRotation + uTime * mix(0.000012, 0.00004, uStorm);
    vec3 photograph = textureLod(uSkyMap, uv, blur).rgb;
    float luminance = dot(photograph, vec3(0.2126, 0.7152, 0.0722));
    float height = max(direction.y, 0.0);
    vec3 clearSky = mix(vec3(0.033, 0.17, 0.38), vec3(0.34, 0.54, 0.69), exp(-height * 6.8));
    float cloudMask = smoothstep(0.65, 1.25, luminance) * smoothstep(0.035, 0.20, height);
    vec3 daylight = mix(clearSky, min(photograph, vec3(0.95)), cloudMask * uCloudCover / (1.0 + blur * 2.5));
    float sunward = pow(max(0.0, dot(normalize(vec3(direction.x, 0.0, direction.z) + vec3(0.00001)), normalize(vec3(uSkySun.x, 0.0, uSkySun.z)))), 5.0);
    vec3 goldenSky = mix(vec3(0.045, 0.14, 0.29), mix(vec3(0.39, 0.48, 0.56), vec3(0.79, 0.45, 0.20), sunward * 0.72), exp(-height * 9.0));
    goldenSky += vec3(0.48, 0.27, 0.10) * pow(max(dot(direction, uSkySun), 0.0), 100.0);
    daylight = mix(daylight, goldenSky + min(photograph, vec3(0.8)) * cloudMask * 0.09, uGolden);
    float cloudBody = luminance / (luminance + 0.45);
    vec3 overcast = vec3(0.018, 0.026, 0.039) + vec3(0.095, 0.105, 0.12) * cloudBody;
    overcast *= 0.88 + 0.2 * exp(-height * 5.0);
    return mix(daylight, overcast, uStorm) + vec3(0.25, 0.32, 0.44) * uFlash;
  }
  vec3 atmosphere(vec3 direction) { return atmosphereFiltered(direction, 0.0); }
`;

export interface SkyAtmosphereResult {
  sky: THREE.Mesh;
  skyMaterial: THREE.ShaderMaterial;
  skyUniforms: {
    uSkySun: { value: THREE.Vector3 };
    uSkyMap: { value: THREE.Texture };
    uSkyRotation: { value: number };
    uStorm: { value: number };
    uFlash: { value: number };
    uWind: { value: number };
    uCloudCover: { value: number };
    uGolden: { value: number };
  };
  sunDirection: THREE.Vector3;
  daylightSunDirection: THREE.Vector3;
  goldenSunDirection: THREE.Vector3;
  sun: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  lightning: THREE.Mesh;
  createLightning: () => void;
  getLightningCount: () => number;
  getStrikeTime: () => number;
  setStrikeTime: (t: number) => void;
  getNextLightning: () => number;
  setNextLightning: (t: number) => void;
}

export function createProceduralSkyFallback(): THREE.DataTexture {
  const width = 256;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const i = (y * width + x) * 4;
      const elevation = (v - 0.5) * Math.PI;
      const skyGrad = Math.max(0, Math.sin(elevation));
      const r = Math.min(255, Math.round((0.3 + 0.5 * skyGrad) * 255));
      const g = Math.min(255, Math.round((0.5 + 0.4 * skyGrad) * 255));
      const b = Math.min(255, Math.round((0.7 + 0.3 * skyGrad) * 255));
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export async function createSkyAndLighting(
  scene: THREE.Scene,
  camera: THREE.Camera,
  compact: boolean,
  timeUniform: { value: number }
): Promise<SkyAtmosphereResult> {
  const TAU = Math.PI * 2;
  const sunDirection = new THREE.Vector3(-0.48, 0.77, -0.42).normalize();
  const sun = new THREE.DirectionalLight(0xfff3d9, 3.05);
  sun.position.copy(sunDirection).multiplyScalar(850);
  sun.castShadow = true;
  sun.shadow.mapSize.set(compact ? 1536 : 2048, compact ? 1536 : 2048);
  Object.assign(sun.shadow.camera, { left: -345, right: 345, top: 260, bottom: -260, near: 50, far: 1450 });
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.38;
  sun.shadow.radius = 2.3;
  sun.shadow.intensity = 0.87;
  scene.add(sun, sun.target);

  const hemisphere = new THREE.HemisphereLight(0xc7e7f6, 0x53644b, 1.45);
  const ambient = new THREE.AmbientLight(0xc5d9db, 0.12);
  scene.add(hemisphere, ambient);

  let hdrSky: THREE.Texture;
  let sourceAzimuth = 0;
  let sourceZenith = 0.7;

  try {
    const SKY_SOURCE = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr';
    hdrSky = await new HDRLoader().loadAsync(SKY_SOURCE);
    const skyImage = hdrSky.image as any;
    const skyPixels = skyImage.data;
    const skyWidth = skyImage.width;
    const skyHeight = skyImage.height;
    let skyEnergy = 0,
      skySamples = 0,
      peakLight = 0,
      peakPixel = 0;

    for (let y = 0; y < skyHeight / 2; y++) {
      for (let x = 0; x < skyWidth; x++) {
        const i = (y * skyWidth + x) * 4;
        const r = THREE.DataUtils.fromHalfFloat(skyPixels[i]);
        const g = THREE.DataUtils.fromHalfFloat(skyPixels[i + 1]);
        const b = THREE.DataUtils.fromHalfFloat(skyPixels[i + 2]);
        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
        skyEnergy += Math.min(luminance, 3);
        skySamples++;
        if (luminance > peakLight) {
          peakLight = luminance;
          peakPixel = y * skyWidth + x;
        }
      }
    }
    const skyExposure = 0.4 / Math.max(0.01, skyEnergy / skySamples);
    for (let i = 0; i < skyPixels.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        skyPixels[i + channel] = THREE.DataUtils.toHalfFloat(
          Math.min(20, THREE.DataUtils.fromHalfFloat(skyPixels[i + channel]) * skyExposure)
        );
      }
    }
    hdrSky.flipY = true;
    hdrSky.wrapS = THREE.RepeatWrapping;
    hdrSky.minFilter = THREE.LinearMipmapLinearFilter;
    hdrSky.magFilter = THREE.LinearFilter;
    hdrSky.generateMipmaps = true;
    hdrSky.needsUpdate = true;
    sourceAzimuth = (((peakPixel % skyWidth) + 0.5) / skyWidth - 0.5) * TAU;
    sourceZenith = ((Math.floor(peakPixel / skyWidth) + 0.5) / skyHeight) * Math.PI;
  } catch (e) {
    console.warn('Could not load online HDR sky, using procedural sky texture fallback.', e);
    hdrSky = createProceduralSkyFallback();
  }

  const sunAzimuth = Math.atan2(sunDirection.z, sunDirection.x);
  sunDirection.set(
    Math.cos(sunAzimuth) * Math.sin(sourceZenith),
    Math.cos(sourceZenith),
    Math.sin(sunAzimuth) * Math.sin(sourceZenith)
  );
  sun.position.copy(sunDirection).multiplyScalar(850);

  const daylightSunDirection = sunDirection.clone();
  const goldenSunDirection = new THREE.Vector3(-0.83, 0.075, -0.55).normalize();

  const skyUniforms = {
    uSkySun: { value: sunDirection },
    uSkyMap: { value: hdrSky },
    uSkyRotation: { value: (sourceAzimuth - sunAzimuth) / TAU },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uWind: { value: 1.15 },
    uCloudCover: { value: 0.23 },
    uGolden: { value: 0 },
  };

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uSunDirection: { value: sunDirection },
      ...skyUniforms,
    },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vSkyDirection;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vSkyDirection = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDirection;
      varying vec3 vSkyDirection;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${noiseGLSL}
      ${skyGLSL}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 direction = normalize(vSkyDirection);
        vec3 col = atmosphere(direction);
        float sunDisk = smoothstep(0.999965, 0.999985, dot(direction, uSunDirection));
        col += vec3(9.0, 7.9, 6.3) * sunDisk * (1.0 - uStorm);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(190000, 32, 20), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // Lightning system
  let nextLightning = Infinity;
  let strikeTime = -100;
  let lightningCount = 0;

  const lightningPositions = new Float32Array(128 * 18);
  const lightningUVs = new Float32Array(128 * 12);
  const lightningGeometry = new THREE.BufferGeometry();
  lightningGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(lightningPositions, 3).setUsage(THREE.DynamicDrawUsage)
  );
  lightningGeometry.setAttribute('uv', new THREE.BufferAttribute(lightningUVs, 2).setUsage(THREE.DynamicDrawUsage));
  lightningGeometry.setDrawRange(0, 0);

  const lightningMaterial = new THREE.ShaderMaterial({
    uniforms: { uFlash: skyUniforms.uFlash },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vBoltUV;
      void main() {
        vBoltUV = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uFlash;
      varying vec2 vBoltUV;
      void main() {
        #include <logdepthbuf_fragment>
        float profile = max(0.0, 1.0 - abs(vBoltUV.x));
        float light = pow(profile, 8.0) + pow(profile, 2.5) * 0.10;
        gl_FragColor = vec4(vec3(0.74, 0.85, 1.0) * 7.0, light * uFlash);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const lightning = new THREE.Mesh(lightningGeometry, lightningMaterial);
  lightning.visible = false;
  lightning.frustumCulled = false;
  lightning.renderOrder = 3;
  scene.add(lightning);

  const lightningForward = new THREE.Vector3();
  const lightningRight = new THREE.Vector3();

  const createLightning = () => {
    let seed = Math.floor(Math.random() * 100000);
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    camera.getWorldDirection(lightningForward);
    lightningForward.y = 0;
    lightningForward.normalize();
    lightningRight.crossVectors(lightningForward, camera.up).normalize();
    const origin = camera.position
      .clone()
      .addScaledVector(lightningForward, 3200 + rnd() * 1400)
      .addScaledVector(lightningRight, (rnd() - 0.5) * 2200);

    let count = 0;
    const segment = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
      if (count >= 128) return;
      const side = lightningRight.clone().multiplyScalar(width);
      const points = [
        a.clone().sub(side),
        a.clone().add(side),
        b.clone().sub(side),
        a.clone().add(side),
        b.clone().add(side),
        b.clone().sub(side),
      ];
      points.forEach((point, index) => point.toArray(lightningPositions, count * 18 + index * 3));
      lightningUVs.set([-1, 0, 1, 0, -1, 1, 1, 0, 1, 1, -1, 1], count * 12);
      count++;
    };

    const path: THREE.Vector3[] = [];
    for (let i = 0; i <= 17; i++) {
      const point = origin
        .clone()
        .addScaledVector(lightningRight, (rnd() - 0.5) * 90 + Math.sin(i * 1.7) * 25);
      point.y = 1320 * (1 - i / 17);
      path.push(point);
      if (i) segment(path[i - 1], point, 8.5);
    }
    for (const index of [5, 9, 12]) {
      let from = path[index].clone();
      const direction = rnd() < 0.5 ? -1 : 1;
      for (let i = 0; i < 5; i++) {
        const to = from.clone().addScaledVector(lightningRight, direction * (35 + rnd() * 45));
        to.y -= 30 + rnd() * 65;
        segment(from, to, 4.5 - i * 0.5);
        from = to;
      }
    }

    lightningGeometry.attributes.position.needsUpdate = true;
    lightningGeometry.attributes.uv.needsUpdate = true;
    lightningGeometry.setDrawRange(0, count * 6);
    strikeTime = timeUniform.value;
    lightningCount++;
    nextLightning = timeUniform.value + 4 + rnd() * 4;
  };

  return {
    sky,
    skyMaterial,
    skyUniforms,
    sunDirection,
    daylightSunDirection,
    goldenSunDirection,
    sun,
    hemisphere,
    ambient,
    lightning,
    createLightning,
    getLightningCount: () => lightningCount,
    getStrikeTime: () => strikeTime,
    setStrikeTime: (t: number) => {
      strikeTime = t;
    },
    getNextLightning: () => nextLightning,
    setNextLightning: (t: number) => {
      nextLightning = t;
    },
  };
}
