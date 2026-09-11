import {
  ACESFilmicToneMapping,
  Color,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  Matrix4,
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { Quality, autoDetectPreset } from './core/Quality';
import { U, updateFrameUniforms } from './core/SharedUniforms';
import { bakeProceduralTextures, BakedTextures } from './gfx/ProceduralTextures';
import { Atmosphere } from './sky/Atmosphere';
import { SkyRenderer } from './sky/SkyRenderer';
import { Clouds } from './sky/Clouds';
import { OceanFFT } from './ocean/OceanFFT';
import { OceanMesh } from './ocean/OceanMesh';
import { Lightning } from './weather/Lightning';
import { Waterspout } from './weather/Waterspout';
import { Rain, Spray } from './weather/Precipitation';
import { Director } from './weather/Director';
import { CinematicCamera } from './camera/CinematicCamera';
import { PostFX } from './post/PostFX';
import { installUI } from './ui/Overlay';
import { Sandbox } from './ui/Sandbox';

export default class SceneManager extends SceneManagerParent {
  quality!: Quality;
  atmosphere!: Atmosphere;
  ocean!: OceanFFT;
  clouds!: Clouds;
  sky!: SkyRenderer;
  oceanMesh!: OceanMesh;
  lightning!: Lightning;
  waterspout!: Waterspout;
  rain!: Rain;
  spray!: Spray;
  director!: Director;
  cine!: CinematicCamera;
  post!: PostFX;
  sandbox?: Sandbox;
  setSandbox?: (on: boolean) => void;

  time = 0;
  timeScale = 1.0;
  frame = 0;
  paused = false;
  frameMs = 16.6;
  renderWidth = window.innerWidth;
  renderHeight = window.innerHeight;
  caps: { renderer: string; webgpu: boolean } = { renderer: '', webgpu: false };

  private _bakedTextures?: BakedTextures;
  private _lastTime = performance.now();
  private _projNoJitter = new Matrix4();
  private _surfaceAudio = new AudioHandler();
  private _underwaterAudio = new AudioHandler();
  private _lastGestureTime = 0;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    this.caps.renderer = renderer.capabilities.isWebGL2 ? 'WebGL 2.0' : 'WebGL 1.0';

    this.quality = new Quality(autoDetectPreset());

    this.cine = new CinematicCamera(camera.aspect);
    this.cine.camera = camera;
    this.camera.near = 0.2;
    this.camera.far = 100000;
    this.camera.fov = 75;
    this.camera.position.set(0, 10, 35);
    this.camera.updateProjectionMatrix();

    this.director = new Director(this);
    this.atmosphere = new Atmosphere(renderer);
    this.ocean = new OceanFFT(renderer, { size: this.quality.fftSize });

    this.lightning = new Lightning();
    this.waterspout = new Waterspout();
    this.waterspout.setLUTs(this.atmosphere);
    this.waterspout.setQuality(this.quality);

    this.rain = new Rain(this.quality);
    this.spray = new Spray(renderer, this.ocean, this.quality);

    this.scene.add(this.waterspout.mesh);
    this.scene.add(this.spray.mesh);
    this.scene.add(this.rain.mesh);
    this.scene.add(this.lightning.mesh);

    // Initial procedural baking
    bakeProceduralTextures(renderer).then((textures) => {
      this._bakedTextures = textures;
      U.uFoamTex.value = textures.foam;
      U.uRippleTex.value = textures.ripple;
      U.uCurlTex.value = textures.curl;

      this.clouds = new Clouds(renderer, this.atmosphere, textures, this.quality);
      this.sky = new SkyRenderer(renderer, this.atmosphere);
      this.oceanMesh = new OceanMesh(this.ocean, this.atmosphere, this.quality, this.clouds.shared);

      this.scene.add(this.sky.mesh);
      this.scene.add(this.oceanMesh.mesh);

      this.cine.seaLevelFn = () => U.uSeaLevel.value;
      this.cine.eventFloorFn = (x, z) => this.director.eventHeight(x, z);

      this.post = new PostFX(renderer, window.innerWidth, window.innerHeight);

      if (typeof document !== 'undefined' && document.getElementById('panel')) {
        installUI(this);
        this.cine.attachInput(renderer.domElement);
      }

      this.director.start();
    });

    // Audio setup
    this._surfaceAudio.initAudio(AudioDemo.ocean);
    if (this._surfaceAudio.audioElement) {
      this._surfaceAudio.audioElement.loop = true;
    }
    const sharedContext = this._surfaceAudio.getAudioContext();
    this._underwaterAudio.initAudio(AudioDemo.underwater, undefined, sharedContext);
    if (this._underwaterAudio.audioElement) {
      this._underwaterAudio.audioElement.loop = true;
    }
    this._surfaceAudio.setGain(0.85);
    this._underwaterAudio.setGain(0.0);
    this.startAudio();
  }

  setQualityPreset(name: string) {
    this.quality.setPreset(name);
    if (this.ocean) this.ocean.markDirty();
    if (this.clouds) this.clouds.setQuality(this.quality);
    if (this.waterspout) this.waterspout.setQuality(this.quality);
    if (this.rain) this.rain.setQuality(this.quality);
    if (this.spray) this.spray.setQuality(this.quality);
    if (this.oceanMesh) this.oceanMesh.setResolution(this.quality.oceanGridX, this.quality.oceanGridY);
  }

  isShadowEnabled(): boolean {
    return false;
  }

  isVR(): boolean {
    return !!(this.scene?.userData?.isXR || this.renderer?.xr?.isPresenting);
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 10, 35);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 4, 0);
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  startAudio() {
    this._surfaceAudio.resume();
    this._underwaterAudio.resume();
    this._surfaceAudio.playFromStart();
    this._underwaterAudio.playFromStart();
  }

  handleGesture(gesture: HandTrackingResult) {
    if (!gesture || gesture.gestureType === GestureType.None) return;
    const now = performance.now();
    if (now - this._lastGestureTime < 1000) return;
    this._lastGestureTime = now;

    if (gesture.gestureType === GestureType.Index_Thumb) {
      this.director?.lightningBurst(8);
    } else if (gesture.gestureType === GestureType.Closed_Hand) {
      this.director?.spawnRogue();
    } else if (gesture.gestureType === GestureType.Open_Hand) {
      this.director?.spawnWaterspout(this.camera.position.x + 40, this.camera.position.z - 250, 32);
    } else if (gesture.gestureType === GestureType.Middle_Thumb || gesture.gestureType === GestureType.Pinky_Thumb) {
      this.director?.spawnTsunami();
    }
  }

  update() {
    const now = performance.now();
    let dt = (now - this._lastTime) * 0.001;
    this._lastTime = now;
    if (dt > 0.1) dt = 0.1;
    this.frameMs = dt * 1000;

    if (!this._bakedTextures || !this.oceanMesh) return;

    if (!this.paused) {
      this.time += dt * this.timeScale;
      this.frame++;

      let proj = this.camera.projectionMatrix;
      if ((this.camera as any).isArrayCamera && (this.camera as any).cameras && (this.camera as any).cameras.length > 0) {
        const subCam = (this.camera as any).cameras[0];
        if (subCam.projectionMatrix) {
          proj = subCam.projectionMatrix;
        }
      }
      this._projNoJitter.copy(proj);
      updateFrameUniforms(this.camera, this._projNoJitter, dt, this.time, this.frame);

      this.director.update(dt * this.timeScale);
      this.ocean.update(dt * this.timeScale);

      this.atmosphere.update(this.camera, this.camera.position);
      this.atmosphere.syncUniforms(U);

      this.sky.update(this.time);
      this.lightning.update(dt * this.timeScale, this.time, this.director.weather.state);
      this.waterspout.update(dt * this.timeScale, this.director.weather.state.cloudBottom);
      this.oceanMesh.update(this.camera.position, U.uSeaLevel.value);
      this.rain.update(this.camera, this.director.weather.state.rain, this.camera.position.y);
      this.spray.update(dt * this.timeScale, this.director.weather.state.spray);

      this.clouds.update(this.time, dt * this.timeScale);
      this.sky.setCloudTextures(this.clouds.screenTexture, this.clouds.envTexture);
      this.sky.renderEnv();

      if (!this.isVR()) {
        this.cine.update(dt * this.timeScale, this.time);
      }

      // Audio handling
      const isUnderwater = this.camera.position.y < U.uSeaLevel.value;
      if (isUnderwater) {
        this._surfaceAudio.setGain(0.1);
        this._underwaterAudio.setGain(0.9);
      } else {
        const storm = this.director.weather.state.storm || 0;
        this._surfaceAudio.setGain(0.6 + storm * 0.4);
        this._underwaterAudio.setGain(0.0);
      }
    }
  }

  afterUpdate?(scaled: number, dt: number): void;
}
