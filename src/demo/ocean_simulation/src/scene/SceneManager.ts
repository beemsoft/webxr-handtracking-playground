import {
  ACESFilmicToneMapping,
  Color,
  DataTexture,
  Fog,
  Light,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { CameraViewPreset, CoastalFieldResult } from './ocean/OceanTypes';
import { buildCoastalField } from './ocean/CoastalField';
import { buildSpectrumGLSL, SpectralCascade } from './ocean/SpectralCascade';
import { FoamSystem } from './ocean/FoamSystem';
import { Caustics } from './ocean/Caustics';
import { WaterSurface } from './ocean/WaterSurface';
import { SurfaceProbe } from './ocean/SurfaceProbe';
import { SurfaceSpray } from './ocean/SurfaceSpray';
import { createParticulate } from './ocean/Particulate';
import { createTerrain, TerrainResult } from './terrain/TerrainGenerator';
import { createRocks, RocksResult } from './terrain/Rocks';
import { createFoliage, FoliageResult } from './terrain/Foliage';
import { createSkyAndLighting, SkyAtmosphereResult, skyGLSL } from './sky/SkyAtmosphere';
import { WeatherManager } from './weather/WeatherManager';
import { HUD } from './ui/HUD';

export default class SceneManager extends SceneManagerParent {
  private controls?: OrbitControls;
  private hud?: HUD;
  private timeUniform = { value: 0 };

  private coastalField!: CoastalFieldResult;
  private cascades!: SpectralCascade[];
  private foamSystem!: FoamSystem;
  private caustics!: Caustics;
  private waterSurface!: WaterSurface;
  private surfaceProbe!: SurfaceProbe;
  private surfaceSpray!: SurfaceSpray;
  private particulate!: Points;
  private terrainResult!: TerrainResult;
  private rocksResult!: RocksResult;
  private foliageResult!: FoliageResult;
  private skyResult!: SkyAtmosphereResult;
  private weatherManager!: WeatherManager;

  private simScene!: Scene;
  private simCamera!: OrthographicCamera;
  private simQuad!: Mesh;

  private views: Record<CameraViewPreset, [Vector3, Vector3]> = {
    aerial: [new Vector3(440, 285, 570), new Vector3(2, 30, 0)],
    waterline: [new Vector3(260, 6.8, 340), new Vector3(-15, 2.5, -5)],
    shallows: [new Vector3(55, 14, 115), new Vector3(52, 1.5, 92)],
    explore: [new Vector3(440, 285, 570), new Vector3(2, 30, 0)],
  };

  private currentViewName: CameraViewPreset = 'aerial';
  private transition: {
    start: number;
    duration: number;
    fromPosition: Vector3;
    fromTarget: Vector3;
    toPosition: Vector3;
    toTarget: Vector3;
  } | null = null;

  private paused = false;
  private cinematic = true;
  private floatHeight = 6.8;
  private floatVelocity = 0;
  private effectQuality = 1.0;
  private detailedTrees = true;
  private lastShadowTime = -Infinity;
  private lastShadowSun = new Vector3();
  private shadowUpdates = 0;
  private frame = 0;
  private ready = false;

  private audioHandler = new AudioHandler();
  private gestureCooldown = 0;

  constructor() {
    super();
  }

  isVR(): boolean {
    return !!(this.scene?.userData?.isXR || this.renderer?.xr?.isPresenting);
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(260, 8.5, 340);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(-15, 3.5, -5);
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    this.scene.fog = new Fog(new Color(0.43, 0.62, 0.73), 2500, 25000);

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.setClearColor(0xb2ccd8, 1);

    this.camera.near = 0.25;
    this.camera.far = 240000;
    this.camera.fov = 75;
    this.camera.position.set(440, 285, 570);
    this.camera.updateProjectionMatrix();

    if (!this.isVR() && renderer.domElement) {
      this.controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls.target.set(2, 30, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.045;
      this.controls.rotateSpeed = 0.42;
      this.controls.panSpeed = 0.65;
      this.controls.zoomSpeed = 0.62;
      this.controls.screenSpacePanning = false;
      this.controls.minDistance = 16;
      this.controls.maxDistance = 2200;
      this.controls.minPolarAngle = 0.12;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.004;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.055;
      this.controls.update();

      this.controls.addEventListener('start', () => {
        this.cinematic = false;
        this.transition = null;
        if (this.controls) {
          this.controls.autoRotate = false;
          this.controls.maxPolarAngle = Math.PI / 2 - 0.004;
        }
        this.currentViewName = 'explore';
        if (this.hud) this.hud.setViewUI('explore');
      });
    }

    const compact = window.innerWidth <= 700;

    // Simulation Orthographic Scene & Quad
    this.simScene = new Scene();
    this.simCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simQuad = new Mesh(new PlaneGeometry(2, 2));
    this.simQuad.frustumCulled = false;
    this.simScene.add(this.simQuad);

    // Audio Handler
    try {
      this.audioHandler.initAudio(AudioDemo.ocean);
      if (this.audioHandler.audioElement) {
        this.audioHandler.audioElement.loop = true;
      }
      this.audioHandler.setGain(0.7);
    } catch (e) {
      console.warn('Audio init skipped', e);
    }

    // Setup async environment loading
    this.setupSceneContent(compact);
  }

  private async setupSceneContent(compact: boolean) {
    // Sky & Lighting
    this.skyResult = await createSkyAndLighting(this.scene, this.camera, compact, this.timeUniform);

    // Spectral Cascades
    const fftResolutions = compact ? [128, 128, 128] : [128, 256, 128];
    this.cascades = [
      new SpectralCascade({
        length: 1792,
        minWave: 20,
        maxWave: 950,
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
        length: 211,
        minWave: 2.5,
        maxWave: 30,
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
        length: 27.3,
        minWave: 0.25,
        maxWave: 3.8,
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

    // Weather Manager
    this.weatherManager = new WeatherManager(
      this.skyResult,
      this.cascades,
      this.scene,
      this.timeUniform,
      false
    );
    this.cascades.forEach((cascade) => {
      cascade.derive.uniforms.uFoamStorm = this.weatherManager.residualStorm;
    });

    const spectrumGLSL = buildSpectrumGLSL(fftResolutions);

    // Rocks bucket for terrain seabed calculations
    const rockBuckets = new Map<string, Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; rotation: number }>>();

    // Initial dummy uniforms
    const defaultBlackTex = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
    defaultBlackTex.needsUpdate = true;

    const causticUniforms = {
      uCausticWide: { value: defaultBlackTex as any },
      uCausticDetail: { value: defaultBlackTex as any },
      uCausticRegion: { value: new Vector3(40, 100, 120) },
      uCausticDetailActive: { value: 0 },
    };
    const foamUniforms = {
      uFoamWide: { value: defaultBlackTex as any },
      uFoamNear: { value: defaultBlackTex as any },
      uFoamRegion: { value: new Vector3(40, 100, 128) },
      uFoamDetail: { value: 0 },
    };

    // Terrain
    this.terrainResult = createTerrain(
      this.scene,
      compact,
      this.timeUniform,
      foamUniforms,
      this.skyResult.skyUniforms,
      causticUniforms,
      skyGLSL,
      rockBuckets
    );

    // Rocks
    this.rocksResult = createRocks(
      this.scene,
      compact,
      this.terrainResult.terrainHeight,
      this.terrainResult.terrainSlope,
      this.terrainResult.coastDistance,
      this.timeUniform,
      foamUniforms,
      this.skyResult.skyUniforms,
      causticUniforms,
      skyGLSL
    );
    this.rocksResult.rockBuckets.forEach((val, key) => rockBuckets.set(key, val));

    // Coastal Field Eikonal Solver
    this.coastalField = await buildCoastalField(
      this.terrainResult.heightData,
      this.terrainResult.mapResolution,
      this.terrainResult.terrainSize,
      compact,
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

    // Foliage (Palm trees, crown broadleaf trees, grass)
    this.foliageResult = createFoliage(
      this.scene,
      this.renderer,
      this.terrainResult.terrainHeight,
      this.terrainResult.terrainSlope,
      this.terrainResult.rockiness,
      this.timeUniform,
      this.skyResult.skyUniforms
    );

    // Foam System
    this.foamSystem = new FoamSystem({
      compact,
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
    // Link foam uniforms
    this.foamSystem.uniforms = foamUniforms;
    foamUniforms.uFoamWide.value = this.foamSystem.levels[0].targets[0].texture;
    foamUniforms.uFoamNear.value = this.foamSystem.levels[1].targets[0].texture;

    // Caustics Generator
    this.caustics = new Caustics({
      compact,
      renderer: this.renderer,
      simulationCamera: this.simCamera,
      spectralUniforms,
      timeUniform: this.timeUniform,
      sunDirection: this.skyResult.sunDirection,
      heightMap: this.terrainResult.heightMap,
      terrainSize: this.terrainResult.terrainSize,
      spectrumGLSL,
    });
    // Link caustics uniforms
    this.caustics.uniforms = causticUniforms;
    causticUniforms.uCausticWide.value = this.caustics.causticWide.texture;
    causticUniforms.uCausticDetail.value = this.caustics.causticDetail.texture;

    // Water Surface Plane & Optics
    this.waterSurface = new WaterSurface({
      compact,
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      spectralUniforms,
      skyUniforms: this.skyResult.skyUniforms,
      foamUniforms,
      bottomMap: this.terrainResult.bottomMap,
      heightMap: this.terrainResult.heightMap,
      terrainSize: this.terrainResult.terrainSize,
      timeUniform: this.timeUniform,
      sunDirection: this.skyResult.sunDirection,
      spectrumGLSL,
    });

    // Surface Probe
    this.surfaceProbe = new SurfaceProbe({
      renderer: this.renderer,
      simulationScene: this.simScene,
      simulationCamera: this.simCamera,
      simulationQuad: this.simQuad,
      uniforms: {
        ...spectralUniforms,
        ...this.skyResult.skyUniforms,
        uTime: this.timeUniform,
        uHeightMap: { value: this.terrainResult.heightMap },
      },
      spectrumGLSL,
    });

    // Surface Spray Particles
    this.surfaceSpray = new SurfaceSpray({
      compact,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      simulationScene: this.simScene,
      simulationCamera: this.simCamera,
      simulationQuad: this.simQuad,
      uniforms: {
        ...spectralUniforms,
        ...this.skyResult.skyUniforms,
        uTime: this.timeUniform,
        uHeightMap: { value: this.terrainResult.heightMap },
      },
      spectrumGLSL,
    });

    // Particulate
    this.particulate = createParticulate(this.scene, {
      ...spectralUniforms,
      ...this.skyResult.skyUniforms,
      uTime: this.timeUniform,
      uHeightMap: { value: this.terrainResult.heightMap },
    });

    // Setup HUD UI
    if (!this.isVR()) {
      this.hud = new HUD({
        onWeatherChange: (w) => this.weatherManager.setWeather(w),
        onViewChange: (v) => this.setView(v),
        onToggleMotion: () => {
          this.paused = !this.paused;
          return this.paused;
        },
        onResetView: () => this.setView('aerial'),
      });
    }

    // Enable layer 1 for underwater / refraction targets
    for (const object of [
      this.terrainResult.terrain,
      this.rocksResult.rocks,
      this.skyResult.sky,
      ...this.scene.children.filter((obj) => (obj as Light).isLight),
    ]) {
      object.layers.enable(1);
    }

    // Initial warmup / simulation passes to ensure all textures, render targets and depth attachments are initialized
    this.cascades.forEach((cascade, i) => {
      cascade.update(0.016);
      this.waterSurface.waterUniforms[`uSlope${i}`].value = cascade.normals[cascade.normalIndex].texture;
    });
    this.foamSystem.update(0.016, this.camera, new Vector3(0, 0, 0), 1.0);
    this.caustics.update(true, false);
    this.waterSurface.captureRefraction();
    this.waterSurface.updateReflection(this.skyResult.sky);

    this.ready = true;
    const loader = document.getElementById('loader');
    if (loader) {
      loader.classList.add('done');
    }
  }

  setView(name: CameraViewPreset) {
    if (!this.views[name]) return;
    this.currentViewName = name;
    const [toPosition, toTarget] = this.views[name].map((val) => val.clone());
    this.cinematic = name === 'aerial';
    if (this.controls) {
      this.controls.autoRotate = false;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.004;
    }
    if (name === 'waterline') {
      this.floatHeight = 6.8;
      this.floatVelocity = 0;
    }
    this.transition = {
      start: performance.now(),
      duration: 2700,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls ? this.controls.target.clone() : new Vector3(0, 0, 0),
      toPosition,
      toTarget,
    };
    if (this.hud) this.hud.setViewUI(name);
  }

  handleGesture(gesture: HandTrackingResult) {
    if (!gesture || gesture.gestureType === GestureType.None) return;
    if (this.gestureCooldown > 0) return;
    if (gesture.gestureType === GestureType.Index_Thumb) {
      const next = this.weatherManager.cycleWeather();
      if (this.hud) this.hud.setWeatherUI(next);
      this.gestureCooldown = 1.0;
    } else if (gesture.gestureType === GestureType.Closed_Hand) {
      this.weatherManager.setWeather('storm');
      if (this.hud) this.hud.setWeatherUI('storm');
      this.gestureCooldown = 1.2;
    } else if (gesture.gestureType === GestureType.Open_Hand) {
      this.weatherManager.setWeather('breeze');
      if (this.hud) this.hud.setWeatherUI('breeze');
      this.gestureCooldown = 1.2;
    } else if (gesture.gestureType === GestureType.Middle_Thumb || gesture.gestureType === GestureType.Pinky_Thumb) {
      const nextView = this.currentViewName === 'waterline' ? 'shallows' : 'waterline';
      this.setView(nextView);
      this.gestureCooldown = 1.2;
    }
  }

  handleLeftHandGesture(gesture: HandTrackingResult): void {
    this.handleGesture(gesture);
  }

  handleRightHandGesture(gesture: HandTrackingResult): void {
    this.handleGesture(gesture);
  }

  onResize(): void {
    if (!this.renderer || !this.camera) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.waterSurface) {
      this.waterSurface.resize(width, height, this.renderer.getPixelRatio());
    }
  }

  update(): void {
    super.update();
    if (!this.ready) return;

    const dt = 0.016;
    if (this.gestureCooldown > 0) {
      this.gestureCooldown = Math.max(0, this.gestureCooldown - dt);
    }

    if (!this.paused) {
      this.timeUniform.value += dt;
    }

    this.weatherManager.update(dt, this.paused);

    if (this.isVR()) {
      if (this.hud) this.hud.setVisible(false);
    } else {
      if (this.transition && this.controls) {
        const now = performance.now();
        const t = Math.max(0, Math.min(1, (now - this.transition.start) / this.transition.duration));
        const ease = t * t * t * (t * (t * 6 - 15) + 10);
        this.camera.position.lerpVectors(this.transition.fromPosition, this.transition.toPosition, ease);
        this.controls.target.lerpVectors(this.transition.fromTarget, this.transition.toTarget, ease);
        if (t === 1) this.transition = null;
      }

      if (this.controls) {
        this.controls.autoRotate = this.cinematic && !this.paused && !this.transition;
        this.controls.update(dt);

        const targetDistance = Math.hypot(this.controls.target.x, this.controls.target.z);
        if (targetDistance > 750) {
          this.controls.target.x *= 750 / targetDistance;
          this.controls.target.z *= 750 / targetDistance;
        }
        this.controls.target.y = Math.max(1.5, Math.min(100, this.controls.target.y));

        if (this.currentViewName === 'waterline' && !this.transition && !this.paused) {
          const buoyantTarget = 6.8 + this.skyResult.skyUniforms.uStorm.value * 5.8 + Math.max(-0.25, Math.min(0.4, this.surfaceProbe.mean * 0.12));
          this.floatVelocity += ((buoyantTarget - this.floatHeight) * 1.7 - this.floatVelocity * 2.5) * dt;
          this.floatHeight += Math.max(-0.3, Math.min(0.3, this.floatVelocity)) * dt;
          this.camera.position.y = this.floatHeight;
          this.controls.target.y = 2.5 + Math.max(-0.08, Math.min(0.08, this.surfaceProbe.mean * 0.035));
          this.camera.lookAt(this.controls.target);
        }

        const floor = Math.max(
          3.5,
          2.5 + this.cascades[0].pack.uniforms.uGain.value * 2.5,
          this.terrainResult.seabedHeight(this.camera.position.x, this.camera.position.z) + 3.2,
          this.currentViewName === 'waterline' ? this.surfaceProbe.ceiling + 1.5 : 0
        );
        if (this.camera.position.y < floor) {
          this.camera.position.y = floor;
          if (this.currentViewName === 'waterline') {
            this.floatHeight = Math.max(this.floatHeight, floor);
            this.floatVelocity = Math.max(0, this.floatVelocity);
          }
          this.camera.lookAt(this.controls.target);
        }
      }
    }

    this.camera.updateMatrixWorld();

    const treeDistance = Math.hypot(this.camera.position.x, this.camera.position.y - 25, this.camera.position.z);
    if (treeDistance < 440) this.detailedTrees = true;
    else if (treeDistance > 500) this.detailedTrees = false;

    this.foliageResult.branchMeshes.forEach((mesh) => {
      mesh.visible = this.detailedTrees;
    });
    this.foliageResult.trunkMesh.visible = !this.detailedTrees;

    this.waterSurface.waterUniforms.uOrigin.value.set(this.camera.position.x, this.camera.position.z);
    const smoothFactor = Math.max(0, Math.min(1, (this.camera.position.y - 5) / (340 - 5)));
    this.waterSurface.waterUniforms.uInnerExtent.value = 220 + (1200 - 220) * (smoothFactor * smoothFactor * (3 - 2 * smoothFactor));

    this.skyResult.sky.position.copy(this.camera.position);

    // Spectrum simulation
    if (!this.paused || !this.ready || this.weatherManager.weatherSettling) {
      this.cascades.forEach((cascade, i) => {
        if (i === 0 && this.frame % 2 !== 0) return;
        cascade.update(i === 0 ? dt * 2 : dt);
        this.waterSurface.waterUniforms[`uSlope${i}`].value = cascade.normals[cascade.normalIndex].texture;
      });
      this.renderer.setRenderTarget(null);
    }

    // Foam & Particle simulation
    if (!this.paused || !this.ready) {
      this.foamSystem.update(dt, this.camera, this.controls ? this.controls.target : new Vector3(0, 0, 0), this.effectQuality);
      this.surfaceSpray.update(dt, this.effectQuality);
      if (this.currentViewName === 'waterline' || this.isVR()) {
        this.surfaceProbe.update(dt, this.camera.position);
      }
    }

    this.particulate.visible = this.camera.position.y < 25 && this.skyResult.skyUniforms.uStorm.value < 0.9;

    // Caustics
    const causticInterval = this.camera.position.y < 80 ? (this.effectQuality < 0.7 ? 4 : 3) : 7;
    if ((this.frame % causticInterval === 0 && this.skyResult.skyUniforms.uStorm.value < 0.86) || !this.ready) {
      const lookDir = new Vector3();
      this.camera.getWorldDirection(lookDir);
      const focusDistance = Math.max(25, Math.min(70, this.camera.position.y / Math.max(0.15, -lookDir.y)));
      const cx = this.camera.position.x + lookDir.x * focusDistance;
      const cz = this.camera.position.z + lookDir.z * focusDistance;
      const focusDepth = -this.terrainResult.terrainHeight(cx, cz);
      const clampVal = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
      const s = (x: number, a: number, b: number) => {
        const t = clampVal(x, a, b);
        return t * t * (3 - 2 * t);
      };
      const detailWeight = (1 - s(this.camera.position.y, 55, 80)) * s(focusDepth, -0.5, 0.5) * (1 - s(focusDepth, 19, 24));
      const detailedCaustics = detailWeight > 0.001;
      this.caustics.uniforms.uCausticDetailActive.value = detailWeight;
      const compact = window.innerWidth <= 700;
      const cellSize = 120 / (compact ? 256 : 448);
      this.caustics.uniforms.uCausticRegion.value.set(
        Math.round(cx / cellSize) * cellSize,
        Math.round(cz / cellSize) * cellSize,
        120
      );
      this.caustics.update(!detailedCaustics || !this.ready || this.frame % (causticInterval * 2) === 0, this.ready);
    }

    // Shadow Map Updates
    const shadowInterval = this.skyResult.skyUniforms.uStorm.value > 0.8 ? 1.0 : this.camera.position.y < 80 ? 0.25 : 0.5;
    if (
      !this.ready ||
      this.skyResult.sunDirection.distanceToSquared(this.lastShadowSun) > 0.00002 ||
      this.timeUniform.value - this.lastShadowTime > shadowInterval
    ) {
      this.renderer.shadowMap.needsUpdate = true;
      this.waterSurface.reflectionDirty = true;
      this.waterSurface.refractionDirty = true;
      this.shadowUpdates++;
      this.lastShadowTime = this.timeUniform.value;
      this.lastShadowSun.copy(this.skyResult.sunDirection);
    }

    // Reflection & Refraction
    if (
      this.waterSurface.reflectionDirty ||
      this.frame % (this.camera.position.y < 25 && this.effectQuality > 0.72 ? 2 : 3) === 0 ||
      !this.ready ||
      this.transition ||
      this.skyResult.skyUniforms.uFlash.value > 0.05
    ) {
      this.waterSurface.updateReflection(this.skyResult.sky);
    }

    if (
      this.waterSurface.refractionDirty ||
      this.transition ||
      this.frame % 3 === 0 ||
      this.skyResult.skyUniforms.uFlash.value > 0.01 ||
      !this.ready
    ) {
      this.waterSurface.captureRefraction();
    } else {
      this.waterSurface.ocean.visible = true;
      this.renderer.setRenderTarget(null);
    }

    this.renderer.toneMapping = ACESFilmicToneMapping;
    if (!this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.camera);
    }
    this.frame++;
  }
}
