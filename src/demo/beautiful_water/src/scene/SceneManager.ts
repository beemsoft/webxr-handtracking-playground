import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { createSky, SkyController } from './sky';
import { createAbyssDome, AbyssDomeController } from './abyss-dome';
import { createOcean, OceanController } from './ocean';
import { createEnvironment, EnvironmentController, seabedHeight } from './environment';
import { createFishSchools, FishSchoolsController } from './fish';
import { createBuoy, BuoyController } from './buoy';
import { createShark, SharkController } from './shark';
import { createStingRays, StingRaysController } from './stingray';
import { createUnderwaterRays, UnderwaterRaysController } from './underwater-rays';
import { sampleOceanSurface } from './waves';

export default class SceneManager extends SceneManagerParent {
  private sunDirection: Vector3 = new Vector3(-0.58, 0.10, -0.81).normalize();
  private sky: SkyController;
  private abyssDome: AbyssDomeController;
  private ocean: OceanController;
  private environment: EnvironmentController;
  private fishSchools: FishSchoolsController;
  private buoy: BuoyController;
  private shark: SharkController;
  private stingRays: StingRaysController;
  private underwaterRays: UnderwaterRaysController;
  private underwaterMix: number = 0;
  private cameraIsUnderwater: boolean = false;
  private elapsedTime: number = 0;
  private surfaceAudioHandler = new AudioHandler();
  private underwaterAudioHandler = new AudioHandler();
  private surfaceAudioElement: HTMLAudioElement;
  private underwaterAudioElement: HTMLAudioElement;
  private isAudioStarted: boolean = false;
  private captureFrameIndex: number = 0;
  private aboveWaterFogColor = new Color(0x063c48);
  private shallowUnderwaterFogColor = new Color(0x0a4d5c);
  private deepUnderwaterFogColor = new Color(0x032833);
  private currentFogColor = new Color(0x063c48);

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.90;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    this.scene.fog = new FogExp2(0x063c48, 0.0017);
    this.scene.background = new Color(0x063c48);

    this.camera.near = 0.08;
    this.camera.far = 320;
    this.camera.fov = 51;
    this.camera.updateProjectionMatrix();

    this.sky = createSky(this.scene, this.sunDirection);
    this.abyssDome = createAbyssDome(this.scene, this.sunDirection);
    this.ocean = createOcean({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      sunDirection: this.sunDirection,
      sky: this.sky,
      sun: this.sky.sun,
    });
    this.environment = createEnvironment(this.scene, this.sunDirection);
    this.fishSchools = createFishSchools(this.scene, this.sunDirection);
    this.buoy = createBuoy(this.scene, this.sunDirection);
    this.shark = createShark(this.scene, this.sunDirection);
    this.stingRays = createStingRays(this.scene, this.sunDirection);
    this.underwaterRays = createUnderwaterRays(this.sunDirection);

    this.surfaceAudioHandler.initAudio(AudioDemo.ocean);
    this.surfaceAudioElement = this.surfaceAudioHandler.audioElement;
    if (this.surfaceAudioElement) {
      this.surfaceAudioElement.loop = true;
    }

    const sharedContext = this.surfaceAudioHandler.getAudioContext();
    this.underwaterAudioHandler.initAudio(AudioDemo.underwater, undefined, sharedContext);
    this.underwaterAudioElement = this.underwaterAudioHandler.audioElement;
    if (this.underwaterAudioElement) {
      this.underwaterAudioElement.loop = true;
    }

    this.surfaceAudioHandler.setGain(1.0);
    this.underwaterAudioHandler.setGain(0.0);

    this.startAudio();
  }

  isShadowEnabled(): boolean {
    return false;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(7.8, 3.65, 10.8);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 0.54, 0);
  }

  private startAudio() {
    if (this.isAudioStarted) return;
    const playPromises: Promise<void>[] = [];
    if (this.surfaceAudioElement) {
      playPromises.push(this.surfaceAudioElement.play());
    }
    if (this.underwaterAudioElement) {
      playPromises.push(this.underwaterAudioElement.play());
    }

    Promise.all(playPromises).then(() => {
      this.isAudioStarted = true;
    }).catch(() => {
      // Audio playback will start upon first user interaction
      const resumeAudio = () => {
        if (!this.isAudioStarted) {
          const promises: Promise<void>[] = [];
          if (this.surfaceAudioElement) promises.push(this.surfaceAudioElement.play());
          if (this.underwaterAudioElement) promises.push(this.underwaterAudioElement.play());
          Promise.all(promises).then(() => {
            this.isAudioStarted = true;
            this.surfaceAudioHandler.resume();
            this.underwaterAudioHandler.resume();
          }).catch(() => {});
        }
        window.removeEventListener('click', resumeAudio);
        window.removeEventListener('touchstart', resumeAudio);
      };
      window.addEventListener('click', resumeAudio);
      window.addEventListener('touchstart', resumeAudio);
    });
  }

  update() {
    super.update();
    const delta = this.timer.getDelta();
    this.elapsedTime += Math.min(delta, 0.1);
    const elapsed = this.elapsedTime;

    // Seabed collision prevention for camera
    const cameraFloor = seabedHeight(this.camera.position.x, this.camera.position.z) + 0.30;
    if (this.camera.position.y < cameraFloor) {
      this.camera.position.y = cameraFloor;
    }

    const cameraSurface = sampleOceanSurface(this.camera.position.x, this.camera.position.z, elapsed);
    const wasUnderwater = this.cameraIsUnderwater;
    const isUnderwaterNow = this.camera.position.y < cameraSurface.height;
    this.cameraIsUnderwater = isUnderwaterNow;
    const underwaterTarget = isUnderwaterNow ? 1 : 0;
    this.underwaterMix = MathUtils.lerp(this.underwaterMix, underwaterTarget, 0.085);

    if (!wasUnderwater && isUnderwaterNow) {
      this.underwaterAudioHandler.playFromStart();
    }

    // Crossfade audio tracks based on camera water immersion
    const surfaceGain = MathUtils.clamp(1.0 - this.underwaterMix, 0.0, 1.0);
    const underwaterGain = MathUtils.clamp(this.underwaterMix, 0.0, 1.0);
    this.surfaceAudioHandler.setGain(surfaceGain);
    this.underwaterAudioHandler.setGain(underwaterGain);

    if (this.ocean) this.ocean.update(elapsed, this.underwaterMix);
    if (this.sky) this.sky.update(elapsed, this.camera);
    if (this.abyssDome) {
      this.abyssDome.update(
        elapsed,
        this.underwaterMix,
        this.camera,
        this.currentFogColor,
        this.shallowUnderwaterFogColor,
        this.deepUnderwaterFogColor
      );
    }
    if (this.environment) this.environment.update(elapsed, this.underwaterMix);
    if (this.buoy) this.buoy.update(elapsed, this.underwaterMix);
    if (this.shark) {
      const cameraDir = new Vector3();
      this.camera.getWorldDirection(cameraDir);
      this.shark.update(
        delta,
        elapsed,
        this.underwaterMix,
        this.cameraIsUnderwater,
        this.camera.position,
        cameraDir
      );
    }
    if (this.fishSchools) {
      this.fishSchools.update(
        elapsed,
        this.underwaterMix,
        this.camera,
        this.shark ? this.shark.position : undefined,
        this.shark ? this.shark.velocity : undefined
      );
    }
    if (this.stingRays) {
      this.stingRays.update(
        delta,
        elapsed,
        this.underwaterMix,
        this.currentFogColor,
        this.camera.position
      );
    }
    if (this.underwaterRays) this.underwaterRays.update(elapsed, this.underwaterMix, this.camera);

    if (this.scene.fog instanceof FogExp2) {
      this.scene.fog.density = MathUtils.lerp(0.0017, 0.075, this.underwaterMix);
      const depthFactor = MathUtils.clamp(-this.camera.position.y / 12.0, 0, 1);
      const targetUnderwaterColor = this.shallowUnderwaterFogColor.clone().lerp(this.deepUnderwaterFogColor, depthFactor);
      this.currentFogColor.copy(this.aboveWaterFogColor).lerp(targetUnderwaterColor, this.underwaterMix);
      this.scene.fog.color.copy(this.currentFogColor);
      if (this.scene.background instanceof Color) {
        this.scene.background.copy(this.currentFogColor);
      }
    }
    this.renderer.toneMappingExposure = MathUtils.lerp(0.90, 0.96, this.underwaterMix);

    this.renderOceanCaptures();
  }

  private renderOceanCaptures() {
    if (!this.ocean || !this.ocean.usesManualCaptures) return;
    const underwaterWorld = [
      ...this.environment.underwaterObjects,
      ...this.fishSchools.underwaterObjects,
      ...this.buoy.underwaterObjects,
      ...(this.shark ? [this.shark.group] : []),
      ...(this.stingRays ? this.stingRays.underwaterObjects : []),
      ...(this.abyssDome ? [this.abyssDome.mesh] : []),
    ];

    underwaterWorld.forEach((object) => { object.visible = true; });
    if (this.underwaterMix < 0.65) {
      this.captureFrameIndex = (this.captureFrameIndex + 1) % 2;
      if (this.captureFrameIndex === 0) {
        this.ocean.renderReflectionCapture(this.buoy.captureHiddenObjects);
      } else {
        this.ocean.renderRefractionCapture(this.buoy.captureHiddenObjects);
      }
    } else {
      this.ocean.renderRefractionCapture(this.buoy.captureHiddenObjects);
    }
    if (!this.cameraIsUnderwater) {
      underwaterWorld.forEach((object) => { object.visible = false; });
    }
  }

  postUpdate() {
    if (this.underwaterRays) {
      this.underwaterRays.render(this.renderer);
    }
  }
}
