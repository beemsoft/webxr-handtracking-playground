import * as THREE from 'three';
import { bathymetryGLSL, historyGLSL, microSurfaceGLSL } from './CoastalField';
import { noiseGLSL } from './NoiseGLSL';
import { skyGLSL } from '../sky/SkyAtmosphere';

export interface WaterSurfaceOptions {
  compact: boolean;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  spectralUniforms: { [key: string]: THREE.IUniform };
  skyUniforms: { [key: string]: THREE.IUniform };
  foamUniforms: { [key: string]: THREE.IUniform };
  heightMap: THREE.DataTexture;
  terrainSize: number;
  timeUniform: { value: number };
  sunDirection: THREE.Vector3;
  spectrumVertGLSL: string;
  spectrumFragGLSL: string;
}

export class WaterSurface {
  ocean: THREE.Mesh;
  waterGeometry: THREE.BufferGeometry;
  waterMaterial: THREE.ShaderMaterial;
  waterUniforms: { [key: string]: THREE.IUniform };

  reflectionDirty = false;
  refractionDirty = false;

  private compact: boolean;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  constructor(options: WaterSurfaceOptions) {
    const { compact, scene, camera, renderer, spectralUniforms, skyUniforms, foamUniforms, heightMap, terrainSize, timeUniform, sunDirection, spectrumVertGLSL, spectrumFragGLSL } = options;
    this.compact = compact;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    const waterVertices: number[] = [];
    const waterIndices: number[] = [];
    const angularSegments = compact ? 160 : 192;
    const radialSegments = 128;
    const TAU = Math.PI * 2;

    for (let r = 0; r <= radialSegments; r++) {
      for (let a = 0; a <= angularSegments; a++) {
        const angle = (a / angularSegments) * TAU;
        waterVertices.push(Math.cos(angle), r / radialSegments, Math.sin(angle));
      }
    }
    for (let r = 0; r < radialSegments; r++) {
      for (let a = 0; a < angularSegments; a++) {
        const i = r * (angularSegments + 1) + a;
        const j = i + angularSegments + 1;
        waterIndices.push(i, i + 1, j, i + 1, j + 1, j);
      }
    }

    this.waterGeometry = new THREE.BufferGeometry();
    this.waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3));
    this.waterGeometry.setIndex(waterIndices);

    const dummyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    dummyTex.needsUpdate = true;

    this.waterUniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...spectralUniforms,
      ...skyUniforms,
      ...foamUniforms,
      uTime: timeUniform,
      uSunDirection: { value: sunDirection },
      uHeightMap: { value: heightMap },
      uTerrainSize: { value: terrainSize },
      uInnerExtent: { value: 500 },
      uOrigin: { value: new THREE.Vector2() },
      uDepthTexture: { value: dummyTex },
      uProjMatrix: { value: new THREE.Matrix4() },
      uViewMatrix: { value: new THREE.Matrix4() },
      uInverseShadowMatrix: { value: new THREE.Matrix4() },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 500 },
    };

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      lights: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        #include <common>
        uniform float uTime, uTerrainSize, uInnerExtent;
        uniform vec2 uOrigin;
        uniform sampler2D uHeightMap;
        varying vec3 vWorld;
        varying vec2 vUndisplaced;
        ${historyGLSL}
        ${spectrumVertGLSL}
        ${bathymetryGLSL}
        void main() {
          float maxExtent = 1250.0;
          float r = position.y <= 0.75 ? uInnerExtent * pow(position.y / 0.75, 1.25) : uInnerExtent * pow(maxExtent / max(uInnerExtent, 1.0), (position.y - 0.75) * 4.0);
          float spacing = position.y <= 0.75 ? max(0.12, uInnerExtent * 1.25 / 192.0 * pow(max(0.001, position.y / 0.75), 0.25)) : r * log(maxExtent / max(uInnerExtent, 1.0)) / 64.0;
          vec2 p = uOrigin + position.xz * r;
          float attenuation = shoreAttenuation(max(0.0, -bedHeight(p)));
          vec3 displacement = waveDisplacement(p, spacing * 1.3, attenuation);
          float tide = 0.07 * sin(uTime * 0.29) + 0.035 * sin(uTime * 0.47 + 1.7);
          vWorld = vec3(p.x, tide, p.y) + displacement;
          vWorld.y -= dot(p - cameraPosition.xz, p - cameraPosition.xz) / 12742000.0;
          vUndisplaced = p;
          vec4 worldPosition = vec4(vWorld, 1.0);
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        uniform float uTime, uTerrainSize;
        uniform vec3 uSunDirection;
        uniform sampler2D uHeightMap;
        uniform sampler2D uDepthTexture;
        uniform mat4 uProjMatrix, uViewMatrix, uInverseShadowMatrix;
        uniform float uCameraNear, uCameraFar;
        varying vec3 vWorld;
        varying vec2 vUndisplaced;
        ${historyGLSL}
        ${noiseGLSL}
        ${skyGLSL}
        ${spectrumFragGLSL}
        ${bathymetryGLSL}
        ${microSurfaceGLSL}
        void main() {
          float floorHeight = bedHeight(vWorld.xz);
          float depth = max(0.0, vWorld.y - floorHeight);
          vec4 coast = coastField(vUndisplaced);
          vec4 history = coastalHistory(vUndisplaced);
          history.rg *= coastalFoamSupport(max(0.0, -floorHeight));
          float footprint = max(length(dFdx(vUndisplaced)), length(dFdy(vUndisplaced)));
          vec3 lod = spectralLOD(footprint);
          vec2 swellP = swellCoordinates(vUndisplaced, coast);
          vec2 windP = windCoordinates(vUndisplaced);
          vec4 wave0 = texture2D(uSlope0, swellP / 896.0);
          vec4 wave1 = texture2D(uSlope1, windP / 105.5);
          vec4 wave2 = texture2D(uSlope2, windP / 13.65);
          vec2 slope = waveSlopeFiltered(vUndisplaced, footprint, 1.0);
          vec3 micro = microSurface(vUndisplaced, footprint, coast.a);
          slope += micro.xy * (1.0 - history.r * 0.65);
          float rockTurbulence = texture2D(uHeightMap, vWorld.xz / uTerrainSize + vec2(0.5)).b * history.r;
          slope += vec2(sin(vWorld.z * 2.1 - uTime * 1.7), cos(vWorld.x * 1.8 + uTime * 1.3)) * rockTurbulence * 0.13;
          vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float NoV = clamp(dot(N, V), 0.025, 1.0);
          float distanceToCamera = distance(cameraPosition, vWorld);
          float variance = max(0.0, wave0.a - dot(wave0.xy, wave0.xy)) * swellEnvelope(max(0.05, depth), coast.a)
            + max(0.0, wave1.a - dot(wave1.xy, wave1.xy)) * pow(mix(0.38, 1.0, coast.a), 2.0)
            + max(0.0, wave2.a - dot(wave2.xy, wave2.xy)) * pow(mix(0.68, 1.0, coast.a), 2.0) + micro.z;
          float pixelSlopeVariance = min(0.02, 0.14 * (dot(dFdx(N), dFdx(N)) + dot(dFdy(N), dFdy(N))));
          float baseRoughness = mix(0.008, 0.032, clamp(uSurfaceWind / 3.6, 0.0, 1.0));
          float alpha = clamp(sqrt(baseRoughness * baseRoughness + variance * 0.32 + pixelSlopeVariance), 0.009, 0.26);
          vec3 reflectionDirection = reflect(-V, N);
          vec3 reflection = atmosphereFiltered(normalize(vec3(reflectionDirection.x, max(0.002, reflectionDirection.y), reflectionDirection.z)), 1.3 + min(3.0, variance * 90.0));
          float fresnel = 0.02037 + 0.97963 * pow(clamp(1.0 - NoV, 0.0, 1.0), 5.0);
          float shadow = 1.0;
          vec3 scatter = vec3(0.004, 0.038, 0.082);
          scatter += vec3(0.004, 0.027, 0.022) * exp(-depth * 0.065);
          scatter *= (0.88 + 0.18 * max(dot(N, uSunDirection), 0.0)) * mix(1.0, 0.45, uStorm);
          vec3 transmission = scatter;
          float contactDepth = depth;

          // Reconstruct view-space / scene depth from Pass 1 Depth Texture (Two-Pass WebXR architecture)
          vec4 shadowProjPos = uProjMatrix * uViewMatrix * vec4(vWorld, 1.0);
          if (shadowProjPos.w > 0.001) {
            vec2 shadowUV = shadowProjPos.xy / shadowProjPos.w * 0.5 + vec2(0.5);
            if (shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0) {
              float depthSample = texture2D(uDepthTexture, shadowUV).x;
              if (depthSample < 0.9999 && depthSample > 0.0001) {
                vec4 ndc = vec4(shadowUV * 2.0 - 1.0, depthSample * 2.0 - 1.0, 1.0);
                vec4 worldPosScene = uInverseShadowMatrix * ndc;
                worldPosScene /= max(0.00001, worldPosScene.w);
                contactDepth = max(0.0, vWorld.y - worldPosScene.y);
              }
            }
          }

          if (depth < 75.0) {
            vec3 bedAlbedo = mix(vec3(0.76, 0.70, 0.50), vec3(0.24, 0.30, 0.25), smoothstep(-2.0, 18.0, -floorHeight));
            vec3 unseenBed = bedAlbedo * (0.24 + max(0.0, uSunDirection.y) * 1.2) * mix(1.0, 0.26, uStorm) * (0.5 + 0.5 * shadow);
            float opticalDepth = min(depth, 50.0);
            vec3 extinction = mix(vec3(0.20, 0.047, 0.021), vec3(0.33, 0.14, 0.09), uStorm);
            vec3 transmittance = exp(-extinction * opticalDepth);
            transmission = unseenBed * transmittance + scatter * (vec3(1.0) - transmittance);
            transmission += vec3(0.004, 0.023, 0.019) * exp(-depth * 0.19) * pow(max(dot(V, -uSunDirection + N * 0.65), 0.0), 3.0);
            transmission = mix(scatter, transmission, 1.0 - smoothstep(35.0, 72.0, depth));
          }
          vec3 halfVector = V + uSunDirection;
          vec3 H = halfVector * inversesqrt(max(dot(halfVector, halfVector), 1e-8));
          float NoL = clamp(dot(N, uSunDirection), 0.001, 1.0);
          float NoH = clamp(dot(N, H), 0.0, 1.0);
          float VoH = clamp(dot(V, H), 0.0, 1.0);
          float a2 = alpha * alpha;
          float denominator = NoH * NoH * (a2 - 1.0) + 1.0;
          float distribution = a2 / max(0.000001, 3.14159265 * denominator * denominator);
          float lambdaV = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
          float lambdaL = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
          float visibility = 0.5 / max(0.0001, lambdaV + lambdaL);
          float specularFresnel = 0.02037 + 0.97963 * pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
          vec3 result = mix(transmission, reflection, fresnel);
          vec3 sunlight = mix(vec3(3.0, 2.85, 2.5), vec3(5.8, 3.75, 1.65), uGolden);
          float highlight = distribution * visibility * specularFresnel * NoL;
          highlight = highlight / (1.0 + highlight / 18.0);
          result += sunlight * highlight * shadow * (1.0 - uStorm * 0.91 + uFlash * 0.25);
          float slopeSteepness = length(slope);
          float crest = wave0.a;
          float crestThin = smoothstep(0.18, 0.80, crest / max(0.4, uSwellGain * 0.62)) * smoothstep(0.09, 0.40, slopeSteepness);
          float backlit = pow(max(dot(-V, uSunDirection), 0.0), 3.0) * (1.0 - smoothstep(0.05, 0.58, uSunDirection.y));
          float crestTransmission = crestThin * backlit * (1.0 - fresnel * 0.7) * shadow * (1.0 - uStorm * 0.85);
          result += vec3(0.015, 0.80, 0.52) * crestTransmission * mix(0.55, 2.8, uGolden) * smoothstep(0.12, 1.4, depth);
          float compression = smoothstep(0.32, 0.7, slopeSteepness) * smoothstep(0.08, 0.5, crest);
          float transformedCrest = crest * swellEnvelope(max(0.05, depth), coast.a) * energyRegion(vUndisplaced);
          float breaker = clamp(breakerPotential(vUndisplaced, transformedCrest, compression), 0.0, 1.0);
          vec2 drift = uWindDirection * uTime * (0.15 + uSurfaceWind * 0.11);
          vec2 foamP = vUndisplaced - drift - coast.yz * uTime * 0.22;
          vec2 streakP = windCoordinates(foamP);
          float streak = noise2(vec2(streakP.x * 0.12, streakP.y * 1.3) + vec2(0.0, sin(streakP.x * 0.023) * 0.8));
          float laceDetail = 0.53;
          if (footprint < 0.45) {
            float cells = fractal(foamP * 1.9 + vec2(sin(uTime * 0.23), cos(uTime * 0.19)) * 0.22);
            laceDetail = mix(smoothstep(0.33, 0.70, cells), 0.53, smoothstep(0.08, 0.45, footprint));
          }
          float ageLace = mix(laceDetail, 1.0, history.g * 0.7);
          float coastalFoam = smoothstep(0.09, 0.82, history.r) * mix(0.12, 0.82, ageLace) * (1.0 + history.g * 0.2);
          float spectralFoam = clamp(wave0.b * 0.12 + wave1.b * 0.8, 0.0, 1.0) * coast.a;
          spectralFoam *= smoothstep(0.58, 0.84, streak) * mix(0.025, 0.40, smoothstep(0.45, 3.4, uSurfaceWind)) * smoothstep(4.0, 14.0, depth);
          float lip = breaker * mix(0.45, 1.0, laceDetail);
          float shoreContact = 1.0 - smoothstep(0.0, 0.75, contactDepth);
          float shoreNoise = noise2(vUndisplaced * 0.35 + vec2(uTime * 0.2, -uTime * 0.15));
          shoreContact = smoothstep(0.15, 0.65, shoreContact * (0.5 + 0.8 * shoreNoise));
          float foam = clamp(coastalFoam + spectralFoam + lip * 0.26 + shoreContact * 0.85, 0.0, 0.94);
          vec3 foamLight = mix(vec3(0.77, 0.84, 0.82), vec3(1.0, 0.90, 0.72), uGolden * 0.65) * (0.54 + shadow * 0.46) * mix(1.0, 0.62, uStorm);
          result = mix(result, foamLight, foam);
          float haze = 1.0 - exp(-pow(distanceToCamera / mix(1100.0, 500.0, uStorm), 1.25));
          result = mix(result, atmosphere(normalize(vec3(-V.x, 0.004, -V.z))), haze);
          gl_FragColor = vec4(result, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.ocean = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
    this.ocean.name = 'OceanSurf';
    this.ocean.visible = true;
    this.ocean.frustumCulled = false;
    this.ocean.receiveShadow = false;
    this.ocean.renderOrder = 1;
    scene.add(this.ocean);
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.reflectionDirty = true;
    this.refractionDirty = true;
  }
}
