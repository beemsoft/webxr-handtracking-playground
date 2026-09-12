import {
  ACESFilmicToneMapping,
  Color,
  DataTexture,
  Fog,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { GestureType, HandTrackingResult, PostProcessingConfig } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { createSkyAndLighting, SkyAtmosphereResult, skyGLSL } from './sky/SkyAtmosphere';
import { createTerrain, TerrainResult } from './terrain/TerrainGenerator';
import { createRocks, RocksResult } from './terrain/Rocks';
import { createFoliage, FoliageResult } from './terrain/Foliage';
import { WeatherManager } from './weather/WeatherManager';
import {
  SpectralCascade,
  buildSpectrumFragGLSL,
  buildSpectrumGLSL,
  buildSpectrumVertGLSL,
} from './ocean/SpectralCascade';
import { buildCoastalFieldSync, CoastalFieldResult } from './ocean/CoastalField';
import { FoamSystem } from './ocean/FoamSystem';
import { Caustics } from './ocean/Caustics';
import { WaterSurface } from './ocean/WaterSurface';

export default class SceneManager extends SceneManagerParent {
  private enableShadows: boolean = true;
  private audioHandler = new AudioHandler();
  private audioElement?: HTMLAudioElement;
  private isAudioStarted = false;

  private timeUniform = { value: 0 };
  private skyResult?: SkyAtmosphereResult;
  private terrainResult?: TerrainResult;
  private rocksResult?: RocksResult;
  private foliageResult?: FoliageResult;
  private weatherManager?: WeatherManager;

  private simScene?: Scene;
  private simCamera?: OrthographicCamera;
  private simQuad?: Mesh;
  private cascades: SpectralCascade[] = [];
  private coastalField?: CoastalFieldResult;
  private foamSystem?: FoamSystem;
  private caustics?: Caustics;
  private waterSurface?: WaterSurface;

  constructor() {
    super();
  }

  isDepthEnabled(): boolean {
    return false;
  }

  isShadowEnabled(): boolean {
    return this.enableShadows;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.enableShadows = enabled;
    if (this.renderer) {
      this.renderer.shadowMap.enabled = enabled;
    }
  }

  toggleShadows(): boolean {
    this.setShadowsEnabled(!this.enableShadows);
    return this.enableShadows;
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return undefined;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(25, 3.5, 45);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(18, 2.0, 20);
  }

  getInitialCameraAngle(): number {
    const pos = this.getInitialCameraPosition();
    const target = this.getInitialCameraTarget();
    return Math.atan2(target.x - pos.x, -(target.z - pos.z));
  }

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    this.scene.fog = new Fog(new Color(0.43, 0.62, 0.73), 2500, 25000);

    this.scene.background = new Color(0x87ceeb);

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.enableShadows;
    renderer.shadowMap.type = PCFShadowMap;

    this.timeUniform = { value: 0 };

    // 1. Sky & Sunlight
    this.skyResult = createSkyAndLighting(this.scene, this.camera, true, this.timeUniform, this.enableShadows);

    // 2. Simulation Orthographic Scene & Quad
    this.simScene = new Scene();
    this.simCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simQuad = new Mesh(new PlaneGeometry(2, 2));
    this.simQuad.frustumCulled = false;
    this.simScene.add(this.simQuad);

    // 3. Spectral Cascades (FFT wave simulation)
    const fftResolutions = [128, 128, 64];
    this.cascades = [
      new SpectralCascade({
        length: 896,
        minWave: 10,
        maxWave: 475,
        rms: 0.49,
        direction: 0.48,
        fftSize: fftResolutions[0],
        renderer: this.renderer,
        simulationScene: this.simScene,
        simulationCamera: this.simCamera,
        simulationQuad: this.simQuad,
        timeUniform: this.timeUniform,
      }),
      new SpectralCascade({
        length: 105.5,
        minWave: 1.25,
        maxWave: 15,
        rms: 0.16,
        direction: 0,
        fftSize: fftResolutions[1],
        renderer: this.renderer,
        simulationScene: this.simScene,
        simulationCamera: this.simCamera,
        simulationQuad: this.simQuad,
        timeUniform: this.timeUniform,
      }),
      new SpectralCascade({
        length: 13.65,
        minWave: 0.12,
        maxWave: 1.9,
        rms: 0.017,
        direction: 0.3,
        fftSize: fftResolutions[2],
        renderer: this.renderer,
        simulationScene: this.simScene,
        simulationCamera: this.simCamera,
        simulationQuad: this.simQuad,
        timeUniform: this.timeUniform,
      }),
    ];
    this.cascades.forEach((cascade, idx) => {
      cascade.pack.uniforms.uGain.value = [1.45, 1.25, 1.1][idx];
    });

    // 4. Dynamic Weather
    this.weatherManager = new WeatherManager(
      this.skyResult,
      this.cascades,
      this.scene,
      this.timeUniform,
      false
    );
    this.cascades.forEach((cascade) => {
      cascade.derive.uniforms.uFoamStorm = this.weatherManager!.residualStorm;
    });

    const spectrumVertGLSL = buildSpectrumVertGLSL(fftResolutions);
    const spectrumFragGLSL = buildSpectrumFragGLSL(fftResolutions);
    const spectrumGLSL = buildSpectrumGLSL(fftResolutions);

    // 5. Foam & Caustic Uniforms setup
    const defaultBlackTex = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
    defaultBlackTex.needsUpdate = true;
    const defaultWhiteTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
    defaultWhiteTex.needsUpdate = true;

    const causticUniforms = {
      uCausticWide: { value: defaultWhiteTex as any },
      uCausticDetail: { value: defaultWhiteTex as any },
      uCausticRegion: { value: new Vector3(20, 50, 60) },
      uCausticDetailActive: { value: 0 },
    };

    const foamUniforms = {
      uFoamWide: { value: defaultBlackTex as any },
      uFoamNear: { value: defaultBlackTex as any },
      uFoamRegion: { value: new Vector3(20, 50, 64) },
      uFoamDetail: { value: 0 },
    };

    // 6. Island Terrain
    const rockBuckets = new Map<string, Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; rotation: number }>>();
    this.terrainResult = createTerrain(
      this.scene,
      true,
      this.timeUniform,
      foamUniforms,
      this.skyResult.skyUniforms,
      causticUniforms,
      skyGLSL,
      rockBuckets,
      this.enableShadows
    );

    // 7. Rock Formations
    this.rocksResult = createRocks(
      this.scene,
      true,
      this.terrainResult.terrainHeight,
      this.terrainResult.terrainSlope,
      this.terrainResult.coastDistance,
      this.timeUniform,
      foamUniforms,
      this.skyResult.skyUniforms,
      causticUniforms,
      skyGLSL,
      this.enableShadows
    );
    this.rocksResult.rockBuckets.forEach((val, key) => rockBuckets.set(key, val));

    // 8. Coastal Field
    this.coastalField = buildCoastalFieldSync(
      this.terrainResult.heightData,
      this.terrainResult.mapResolution,
      this.terrainResult.terrainSize,
      true,
      this.renderer.extensions.has('OES_texture_float_linear')
    );

    const spectralUniforms: { [key: string]: any } = {
      uCoastMap: { value: this.coastalField.texture },
      uSwellGain: this.cascades[0].pack.uniforms.uGain,
      uSurfaceWind: this.weatherManager.surfaceWind,
      uWindDirection: this.weatherManager.windDirection,
    };
    this.cascades.forEach((cascade, i) => {
      spectralUniforms[`uDisplacement${i}`] = { value: cascade.displacement.texture };
      spectralUniforms[`uSlope${i}`] = { value: cascade.normals[0].texture };
    });

    // 9. Island Foliage (Instanced canopies, grove trees, trunks, palms, ground cover)
    this.foliageResult = createFoliage(
      this.scene,
      this.renderer,
      this.terrainResult.terrainHeight,
      this.terrainResult.terrainSlope,
      this.terrainResult.rockiness,
      this.timeUniform,
      this.skyResult.skyUniforms,
      this.enableShadows
    );

    // 10. Foam System
    this.foamSystem = new FoamSystem({
      compact: true,
      renderer: this.renderer,
      simulationScene: this.simScene,
      simulationCamera: this.simCamera,
      simulationQuad: this.simQuad,
      uniforms: {
        ...spectralUniforms,
        uTime: this.timeUniform,
        uHeightMap: { value: this.terrainResult.heightMap },
        uStorm: this.weatherManager.residualStorm,
      },
      spectrumGLSL,
    });
    this.foamSystem.uniforms = foamUniforms;
    foamUniforms.uFoamWide.value = this.foamSystem.levels[0].targets[0].texture;
    foamUniforms.uFoamNear.value = this.foamSystem.levels[1].targets[0].texture;

    // 11. Caustics System
    this.caustics = new Caustics({
      compact: true,
      renderer: this.renderer,
      simulationCamera: this.simCamera,
      spectralUniforms,
      timeUniform: this.timeUniform,
      sunDirection: this.skyResult.sunDirection,
      heightMap: this.terrainResult.heightMap,
      terrainSize: this.terrainResult.terrainSize,
      spectrumGLSL,
    });
    this.caustics.uniforms = causticUniforms;
    causticUniforms.uCausticWide.value = this.caustics.causticWide.texture;
    causticUniforms.uCausticDetail.value = this.caustics.causticDetail.texture;

    // 12. Ocean Water Surface (Ocean Simulation Water Shader)
    this.waterSurface = new WaterSurface({
      compact: true,
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      spectralUniforms,
      skyUniforms: this.skyResult.skyUniforms,
      foamUniforms,
      heightMap: this.terrainResult.heightMap,
      terrainSize: this.terrainResult.terrainSize,
      timeUniform: this.timeUniform,
      sunDirection: this.skyResult.sunDirection,
      spectrumVertGLSL,
      spectrumFragGLSL,
    });

    // Warmup simulation passes
    this.cascades.forEach((cascade, i) => {
      cascade.update(0.016);
      this.waterSurface!.waterUniforms[`uSlope${i}`].value = cascade.normals[cascade.normalIndex].texture;
    });
    if (this.foamSystem) {
      this.foamSystem.update(0.016, this.camera, new Vector3(0, 0, 0), 1.0);
    }
    if (this.caustics) {
      this.caustics.update(true, true);
    }
    this.renderer.setRenderTarget(null);

    // 11. Audio
    try {
      this.audioHandler.initAudio(AudioDemo.ocean);
      this.audioElement = this.audioHandler.audioElement;
      if (this.audioElement) {
        this.audioElement.loop = true;
      }
      this.startAudio();
    } catch (e) {
      console.warn('Audio init skipped:', e);
    }
  }

  update() {
    super.update();
    const time = this.timer.getElapsed();
    const delta = this.timer.getDelta();
    this.timeUniform.value = time;

    if (this.skyResult) {
      this.skyResult.sky.position.copy(this.camera.position);
    }

    if (this.weatherManager) {
      this.weatherManager.update(delta, false);
    }

    if (this.waterSurface) {
      this.waterSurface.waterUniforms.uOrigin.value.set(this.camera.position.x, this.camera.position.z);
      if (this.skyResult && this.waterSurface.waterUniforms.uSunDirection) {
        this.waterSurface.waterUniforms.uSunDirection.value.copy(this.skyResult.sunDirection);
      }
    }

    if (this.cascades && this.cascades.length > 0 && this.waterSurface) {
      this.cascades.forEach((cascade, i) => {
        cascade.update(delta);
        this.waterSurface!.waterUniforms[`uSlope${i}`].value = cascade.normals[cascade.normalIndex].texture;
      });
      if (this.foamSystem) {
        this.foamSystem.update(delta, this.camera, new Vector3(0, 0, 0), 1.0);
      }
      if (this.caustics) {
        this.caustics.update(true, true);
      }
      this.renderer.setRenderTarget(null);
    }

    if (this.camera && this.audioHandler) {
      this.updateShoreAudio();
    }
  }

  private updateShoreAudio() {
    if (!this.terrainResult || !this.camera) return;

    this.audioHandler.setListenerFromMatrix(this.camera.matrixWorld);

    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    const d = this.terrainResult.coastDistance(camX, camZ);

    // Compute shoreline normal vector pointing outward to ocean
    const delta = 0.5;
    const gradX = (this.terrainResult.coastDistance(camX + delta, camZ) - this.terrainResult.coastDistance(camX - delta, camZ)) / (2 * delta);
    const gradZ = (this.terrainResult.coastDistance(camX, camZ + delta) - this.terrainResult.coastDistance(camX, camZ - delta)) / (2 * delta);
    const len = Math.hypot(gradX, gradZ);
    const nx = len > 0.0001 ? gradX / len : 0;
    const nz = len > 0.0001 ? gradZ / len : 1;

    // When inland (d < 0), sound emits from the nearest shoreline.
    // When at the shore or in ocean (d >= 0), sound surrounds user.
    const inlandDist = Math.max(0, -d);
    const shoreX = camX + nx * inlandDist;
    const shoreZ = camZ + nz * inlandDist;
    this.audioHandler.setPosition({ x: shoreX, y: 0, z: shoreZ });

    // Smoothly fade ocean sound as player moves towards the center of the island (inland depth >= 35m)
    const maxInlandFadeDistance = 35.0;
    const t = Math.max(0, Math.min(1, 1 - inlandDist / maxInlandFadeDistance));
    const gain = t * t * (3 - 2 * t);
    this.audioHandler.setGain(gain);
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType === GestureType.Open_Hand) {
      this.startAudio();
      this.weatherManager?.setWeather('breeze');
    } else if (gesture.gestureType === GestureType.Closed_Hand) {
      this.weatherManager?.setWeather('storm');
    } else if (gesture.gestureType === GestureType.Pinky_Thumb) {
      this.weatherManager?.cycleWeather();
    }
  }

  private startAudio() {
    if (!this.isAudioStarted && this.audioElement) {
      this.isAudioStarted = true;
      this.audioHandler.resume();
      this.audioElement.play().catch((e) => {
        console.warn('Audio play failed:', e);
        this.isAudioStarted = false;
      });
    }
  }
}
