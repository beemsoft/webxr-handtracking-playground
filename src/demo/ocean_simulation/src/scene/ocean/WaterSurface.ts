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
  bottomMap: THREE.DataTexture;
  heightMap: THREE.DataTexture;
  terrainSize: number;
  timeUniform: { value: number };
  sunDirection: THREE.Vector3;
  spectrumGLSL: string;
}

export class WaterSurface {
  ocean: THREE.Mesh;
  waterGeometry: THREE.BufferGeometry;
  waterMaterial: THREE.ShaderMaterial;
  waterUniforms: { [key: string]: THREE.IUniform };

  reflectionTarget: THREE.WebGLRenderTarget;
  refractionTarget: THREE.WebGLRenderTarget;
  reflectionCamera: THREE.PerspectiveCamera;
  refractionCamera: THREE.PerspectiveCamera;

  reflectionDirty = true;
  refractionDirty = true;
  lastRefractionPose = new THREE.Matrix4();

  private compact: boolean;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private reflectionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08);
  private lookDirection = new THREE.Vector3();
  private reflectedTarget = new THREE.Vector3();
  private reflectionBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private reflectionMatrix = new THREE.Matrix4();
  private sceneViewProjection = new THREE.Matrix4();
  private sceneCameraWorld = new THREE.Matrix4();
  private sceneInverseProjection = new THREE.Matrix4();

  constructor(options: WaterSurfaceOptions) {
    const { compact, scene, camera, renderer, spectralUniforms, skyUniforms, foamUniforms, bottomMap, heightMap, terrainSize, timeUniform, sunDirection, spectrumGLSL } = options;
    this.compact = compact;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    const waterVertices: number[] = [];
    const waterIndices: number[] = [];
    const angularSegments = compact ? 288 : 448;
    const radialSegments = 256;
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

    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;

    this.reflectionTarget = new THREE.WebGLRenderTarget(compact ? 512 : 768, 512, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.reflectionTarget.texture.generateMipmaps = true;
    this.reflectionTarget.samples = compact ? 0 : 2;

    this.refractionTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.refractionTarget.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);

    this.refractionCamera = camera.clone();
    this.reflectionCamera = new THREE.PerspectiveCamera();

    this.waterUniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...spectralUniforms,
      ...skyUniforms,
      ...foamUniforms,
      uBottomMap: { value: bottomMap },
      uTime: timeUniform,
      uSunDirection: { value: sunDirection },
      uHeightMap: { value: heightMap },
      uTerrainSize: { value: terrainSize },
      uInnerExtent: { value: 1000 },
      uOrigin: { value: new THREE.Vector2() },
      uReflection: { value: this.reflectionTarget.texture },
      uReflectionMatrix: { value: this.reflectionMatrix },
      uSceneColor: { value: this.refractionTarget.texture },
      uSceneDepth: { value: this.refractionTarget.depthTexture },
      uResolution: { value: new THREE.Vector2(width, height) },
      uInverseProjection: { value: this.sceneInverseProjection },
      uCameraWorld: { value: this.sceneCameraWorld },
      uSceneViewProjection: { value: this.sceneViewProjection },
      uLogFar: { value: Math.log2((camera.far || 240000) + 1) },
    };

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      lights: true,
      side: THREE.FrontSide,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <shadowmap_pars_vertex>
        uniform float uTime, uTerrainSize, uInnerExtent;
        uniform vec2 uOrigin;
        uniform sampler2D uHeightMap;
        uniform mat4 uReflectionMatrix;
        varying vec3 vWorld;
        varying vec2 vUndisplaced;
        varying vec4 vReflection;
        ${historyGLSL}
        ${spectrumGLSL}
        ${bathymetryGLSL}
        void main() {
          float r = position.y <= 0.75 ? uInnerExtent * pow(position.y / 0.75, 1.25) : uInnerExtent * pow(150000.0 / uInnerExtent, (position.y - 0.75) * 4.0);
          float spacing = position.y <= 0.75 ? max(0.12, uInnerExtent * 1.25 / 192.0 * pow(max(0.001, position.y / 0.75), 0.25)) : r * log(150000.0 / uInnerExtent) / 64.0;
          vec2 p = uOrigin + position.xz * r;
          float attenuation = shoreAttenuation(max(0.0, -bedHeight(p)));
          vec3 displacement = waveDisplacement(p, spacing * 1.3, attenuation);
          float tide = 0.07 * sin(uTime * 0.29) + 0.035 * sin(uTime * 0.47 + 1.7);
          vWorld = vec3(p.x, tide, p.y) + displacement;
          vWorld.y -= dot(p - cameraPosition.xz, p - cameraPosition.xz) / 12742000.0;
          vUndisplaced = p;
          vReflection = uReflectionMatrix * vec4(vWorld, 1.0);
          vec4 worldPosition = vec4(vWorld, 1.0);
          vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <shadowmap_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        #include <logdepthbuf_pars_fragment>
        #include <lights_pars_begin>
        #include <shadowmap_pars_fragment>
        #include <shadowmask_pars_fragment>
        uniform float uTime, uTerrainSize, uLogFar;
        uniform vec2 uResolution;
        uniform vec3 uSunDirection;
        uniform sampler2D uHeightMap, uBottomMap, uReflection, uSceneColor, uSceneDepth;
        uniform mat4 uSceneViewProjection, uInverseProjection, uCameraWorld;
        varying vec3 vWorld;
        varying vec2 vUndisplaced;
        varying vec4 vReflection;
        ${historyGLSL}
        ${noiseGLSL}
        ${skyGLSL}
        ${spectrumGLSL}
        ${bathymetryGLSL}
        ${microSurfaceGLSL}
        vec3 scenePosition(vec2 uv) {
          float z = exp2(texture2D(uSceneDepth, uv).r * uLogFar) - 1.0;
          vec4 ray = uInverseProjection * vec4(uv * 2.0 - vec2(1.0), 1.0, 1.0);
          return (uCameraWorld * vec4(ray.xyz * z / max(0.001, -ray.z), 1.0)).xyz;
        }
        void main() {
          #include <logdepthbuf_fragment>
          float floorHeight = bedHeight(vWorld.xz);
          float depth = max(0.0, vWorld.y - floorHeight);
          vec4 coast = coastField(vUndisplaced);
          vec4 history = coastalHistory(vUndisplaced);
          history.rg *= coastalFoamSupport(max(0.0, -floorHeight));
          float footprint = max(length(dFdx(vUndisplaced)), length(dFdy(vUndisplaced)));
          vec3 lod = spectralLOD(footprint);
          vec2 swellP = swellCoordinates(vUndisplaced, coast);
          vec2 windP = windCoordinates(vUndisplaced);
          vec4 wave0 = textureLod(uSlope0, swellP / 1792.0, lod.x);
          vec4 wave1 = textureLod(uSlope1, windP / 211.0, lod.y);
          vec4 wave2 = textureLod(uSlope2, windP / 27.3, lod.z);
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
          vec2 reflectionUV = vReflection.xy / max(abs(vReflection.w), 0.001);
          reflectionUV += vec2(slope.x * 0.004, slope.y * 0.022) * (1.0 - smoothstep(200.0, 1100.0, cameraPosition.y));
          vec4 landReflection = textureLod(uReflection, clamp(reflectionUV, vec2(0.001), vec2(0.999)), 0.55 + min(2.0, alpha * 8.0 + variance * 18.0));
          float reflectionEdge = min(min(reflectionUV.x, 1.0 - reflectionUV.x), min(reflectionUV.y, 1.0 - reflectionUV.y));
          float reflectionValidity = smoothstep(0.0, 0.07, reflectionEdge) * step(0.001, vReflection.w);
          reflection = mix(reflection, max(landReflection.rgb, vec3(0.0)) + reflection * (1.0 - clamp(landReflection.a, 0.0, 1.0)), reflectionValidity);
          float fresnel = 0.02037 + 0.97963 * pow(clamp(1.0 - NoV, 0.0, 1.0), 5.0);
          float shadow = getShadowMask();
          vec3 scatter = vec3(0.004, 0.038, 0.082);
          scatter += vec3(0.004, 0.027, 0.022) * exp(-depth * 0.065);
          scatter *= (0.88 + 0.18 * max(dot(N, uSunDirection), 0.0)) * mix(1.0, 0.45, uStorm);
          vec3 transmission = scatter;
          float contactDepth = depth;
          if (depth < 75.0) {
            vec4 sourceProjected = uSceneViewProjection * vec4(vWorld, 1.0);
            vec2 screenUV = clamp(sourceProjected.xy / max(0.001, sourceProjected.w) * 0.5 + vec2(0.5), vec2(0.0005), vec2(0.9995));
            vec3 basePosition = scenePosition(screenUV);
            contactDepth = max(0.0, vWorld.y - basePosition.y);
            vec3 refracted = refract(-V, N, 0.7501875);
            float rayLength = min(depth / max(0.25, -refracted.y), 160.0);
            vec3 bottomPoint = vWorld + refracted * rayLength;
            for (int i = 0; i < 5; i++) {
              float targetLength = max(0.0, vWorld.y - bedHeight(bottomPoint.xz)) / max(0.25, -refracted.y);
              rayLength = clamp(mix(rayLength, targetLength, 0.65), 0.0, 160.0);
              bottomPoint = vWorld + refracted * rayLength;
            }
            vec4 projected = uSceneViewProjection * vec4(bottomPoint, 1.0);
            vec2 refractedUV = projected.w > 0.001 ? projected.xy / max(projected.w, 0.001) * 0.5 + vec2(0.5) : screenUV;
            float refractionEdge = min(min(refractedUV.x, 1.0 - refractedUV.x), min(refractedUV.y, 1.0 - refractedUV.y));
            float refractionWeight = smoothstep(0.015, 0.12, refractionEdge) * smoothstep(0.0, 1.6, depth);
            refractedUV = clamp(mix(screenUV, refractedUV, refractionWeight), vec2(0.0005), vec2(0.9995));
            vec3 receiver = scenePosition(refractedUV);
            float opticalDepth = rayLength;
            vec3 extinction = mix(vec3(0.20, 0.047, 0.021), vec3(0.33, 0.14, 0.09), uStorm);
            vec3 transmittance = exp(-extinction * opticalDepth);
            float receiverConfidence = (1.0 - smoothstep(0.8, 4.0 + rayLength * 0.06, distance(receiver, bottomPoint))) * smoothstep(0.0, 0.03, refractionEdge);
            receiverConfidence *= 1.0 - smoothstep(vWorld.y - 0.08, vWorld.y + 0.03, receiver.y);
            vec3 bedAlbedo = texture2D(uBottomMap, clamp(bottomPoint.xz / uTerrainSize + vec2(0.5), vec2(0.001), vec2(0.999))).rgb;
            vec3 unseenBed = bedAlbedo * (0.24 + max(0.0, uSunDirection.y) * 1.2) * mix(1.0, 0.26, uStorm) * (0.5 + 0.5 * shadow);
            vec3 bottomRadiance = mix(unseenBed, texture2D(uSceneColor, refractedUV).rgb, receiverConfidence);
            transmission = bottomRadiance * transmittance + scatter * (vec3(1.0) - transmittance);
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
          float crest = textureLod(uDisplacement0, swellP / 1792.0, lod.x).y;
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
          float foam = clamp(coastalFoam + spectralFoam + lip * 0.26, 0.0, 0.94);
          vec3 foamLight = mix(vec3(0.77, 0.84, 0.82), vec3(1.0, 0.90, 0.72), uGolden * 0.65) * (0.54 + shadow * 0.46) * mix(1.0, 0.62, uStorm);
          result = mix(result, foamLight, foam);
          float haze = 1.0 - exp(-pow(distanceToCamera / mix(17500.0, 4800.0, uStorm), 1.25));
          result = mix(result, atmosphere(normalize(vec3(-V.x, 0.004, -V.z))), haze);
          gl_FragColor = vec4(result, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.ocean = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
    this.ocean.frustumCulled = false;
    this.ocean.receiveShadow = true;
    this.ocean.renderOrder = 1;
    scene.add(this.ocean);
  }

  updateReflection(skyMesh: THREE.Mesh) {
    this.reflectionCamera.copy(this.camera);
    this.reflectionCamera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) * 1.26)
    );
    this.reflectionCamera.updateProjectionMatrix();
    this.reflectionCamera.position.y *= -1;
    this.camera.getWorldDirection(this.lookDirection);
    this.reflectedTarget.copy(this.camera.position).add(this.lookDirection);
    this.reflectedTarget.y *= -1;
    this.reflectionCamera.up.set(0, -1, 0);
    this.reflectionCamera.lookAt(this.reflectedTarget);
    this.reflectionCamera.updateMatrixWorld();
    this.reflectionMatrix
      .copy(this.reflectionBias)
      .multiply(this.reflectionCamera.projectionMatrix)
      .multiply(this.reflectionCamera.matrixWorldInverse);

    this.ocean.visible = false;
    skyMesh.visible = false;
    this.renderer.clippingPlanes = [this.reflectionPlane];
    this.renderer.setRenderTarget(this.reflectionTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.reflectionCamera);
    this.renderer.clippingPlanes = [];
    skyMesh.visible = true;
    this.ocean.visible = true;
    this.reflectionDirty = false;
    this.renderer.setRenderTarget(null);
  }

  captureRefraction() {
    this.ocean.visible = false;
    this.refractionCamera.copy(this.camera);
    this.refractionCamera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) * 1.26)
    );
    this.refractionCamera.updateProjectionMatrix();
    this.refractionCamera.layers.set(1);
    this.sceneViewProjection.copy(this.refractionCamera.projectionMatrix).multiply(this.refractionCamera.matrixWorldInverse);
    this.sceneCameraWorld.copy(this.refractionCamera.matrixWorld);
    this.sceneInverseProjection.copy(this.refractionCamera.projectionMatrixInverse);
    this.renderer.setRenderTarget(this.refractionTarget);
    this.renderer.setClearColor(0xb2ccd8, 1);
    this.renderer.render(this.scene, this.refractionCamera);
    this.lastRefractionPose.copy(this.camera.matrixWorld);
    this.refractionDirty = false;
    this.ocean.visible = true;
    this.renderer.setRenderTarget(null);
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.waterUniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    const reflectionScale = Math.min((this.compact ? 512 : 768) / width, 768 / height);
    this.reflectionTarget.setSize(
      Math.max(1, Math.round(width * reflectionScale)),
      Math.max(1, Math.round(height * reflectionScale))
    );
    const refractionScale = Math.min(pixelRatio, 1.25);
    this.refractionTarget.setSize(
      Math.max(1, Math.round(width * refractionScale)),
      Math.max(1, Math.round(height * refractionScale))
    );
    this.reflectionDirty = true;
    this.refractionDirty = true;
  }
}
