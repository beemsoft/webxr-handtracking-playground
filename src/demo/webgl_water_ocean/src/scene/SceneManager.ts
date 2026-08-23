import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  FogExp2,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';

import { createSky, SkyController } from './sky/Sky';
import { createAbyssDome, AbyssDomeController } from './abyss/AbyssDome';
import { createSeabed, SeabedController } from './environment/Seabed';
import { createFishSchools, FishSchoolsController } from './fish/FishSchools';
import { createShark, SharkController } from './shark/Shark';
import { createStingRays, StingRaysController } from './stingray/StingRays';
import { WaterSimulation } from './water/WaterSimulation';
import { Caustics } from './water/Caustics';
import { createWaterMesh, WaterMeshController } from './water/WaterMesh';
import { SplashEffect, SIMULATION_RADIUS } from './water/SplashEffect';

export default class SceneManager extends SceneManagerParent {
  private sunDirection: Vector3 = new Vector3(-0.58, 0.52, -0.62).normalize();
  private sky: SkyController;
  private abyssDome: AbyssDomeController;
  private seabed: SeabedController;
  private fishSchools: FishSchoolsController;
  private shark: SharkController;
  private stingRays: StingRaysController;

  private waterSimulation: WaterSimulation;
  private caustics: Caustics;
  private waterMesh: WaterMeshController;
  private splashEffect: SplashEffect;
  private waterTexture: any = null;
  private causticsTexture: any = null;

  private clock = new Clock();
  private elapsedTime = 0;
  private underwaterMix = 0;
  private cameraIsUnderwater = false;

  private surfaceAudioHandler = new AudioHandler();
  private underwaterAudioHandler = new AudioHandler();
  private surfaceAudioElement: HTMLAudioElement;
  private underwaterAudioElement: HTMLAudioElement;
  private isAudioStarted = false;

  private aboveWaterFogColor = new Color(0x063c48);
  private shallowUnderwaterFogColor = new Color(0x0a4d5c);
  private deepUnderwaterFogColor = new Color(0x032833);
  private currentFogColor = new Color(0x063c48);

  private latestGesture = GestureType.None;
  private raycaster = new Raycaster();
  private mouse = new Vector2();
  private waterPlane = new Plane(new Vector3(0, 1, 0), 0);
  private planeIntersect = new Vector3();
  private lastPointerSplashPos = new Vector3();
  private isPointerDown = false;
  private ambientDropTimer = 0;

  private lastHandSmashTime = 0;
  private prevHandPosition = new Vector3();
  private hasPrevHandPosition = false;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    // Natural 10-meter underwater fog setting
    this.scene.fog = new FogExp2(0x063c48, 0.002);
    this.scene.background = new Color(0x063c48);

    this.camera.near = 0.08;
    this.camera.far = 350;
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();

    // Lighting
    const ambientLight = new AmbientLight(0xdcf5f8, 1.2);
    this.scene.add(ambientLight);

    const directionalLight = new DirectionalLight(0xfff5dd, 2.2);
    directionalLight.position.set(-this.sunDirection.x * 100, this.sunDirection.y * 100, -this.sunDirection.z * 100);
    this.scene.add(directionalLight);

    // Sky & Underwater Abyss Dome
    this.sky = createSky(this.scene, this.sunDirection);
    this.abyssDome = createAbyssDome(this.scene, this.sunDirection);

    // Sandy Ocean Floor Habitat
    this.seabed = createSeabed(this.scene, this.sunDirection);

    // Groups of Fish
    this.fishSchools = createFishSchools(this.scene, this.sunDirection);

    // Patrolling Shark
    this.shark = createShark(this.scene, this.sunDirection);

    // Group of Sting Rays Roaming Near Sea Floor
    this.stingRays = createStingRays(this.scene, this.sunDirection);

    // Water GPU Simulation & Caustics Pipeline
    this.waterSimulation = new WaterSimulation();
    this.caustics = new Caustics(128);
    this.waterMesh = createWaterMesh(120, 128, SIMULATION_RADIUS * 2.0);
    this.scene.add(this.waterMesh.mesh);

    // Realistic Hand Splash & Droplet Spray System
    this.splashEffect = new SplashEffect(this.scene);

    // Add initial small ripples for lively caustics immediately
    for (let i = 0; i < 20; i++) {
      this.waterSimulation.addDrop(
        this.renderer,
        (Math.random() * 2 - 1) * 0.8,
        (Math.random() * 2 - 1) * 0.8,
        0.008,
        (i & 1) ? 0.025 : -0.025
      );
    }

    // Audio handlers
    this.surfaceAudioHandler.initAudio(AudioDemo.ocean);
    this.surfaceAudioElement = this.surfaceAudioHandler.audioElement;
    if (this.surfaceAudioElement) this.surfaceAudioElement.loop = true;

    const sharedContext = this.surfaceAudioHandler.getAudioContext();
    this.underwaterAudioHandler.initAudio(AudioDemo.underwater, undefined, sharedContext);
    this.underwaterAudioElement = this.underwaterAudioHandler.audioElement;
    if (this.underwaterAudioElement) this.underwaterAudioElement.loop = true;

    this.surfaceAudioHandler.setGain(1.0);
    this.underwaterAudioHandler.setGain(0.0);
    this.startAudio();

    // Setup desktop mouse/pointer splash interaction
    this.setupPointerSplash();
  }

  private setupPointerSplash() {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      this.isPointerDown = true;
      this.triggerPointerSmash(event);
    };

    const onPointerMove = (event: MouseEvent | TouchEvent) => {
      if (this.isPointerDown) {
        this.triggerPointerDrag(event);
      }
    };

    const onPointerUp = () => {
      this.isPointerDown = false;
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);
  }

  private updatePointerCoords(event: MouseEvent | TouchEvent) {
    let clientX = 0;
    let clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  }

  private triggerPointerSmash(event: MouseEvent | TouchEvent) {
    this.updatePointerCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (this.raycaster.ray.intersectPlane(this.waterPlane, this.planeIntersect)) {
      this.lastPointerSplashPos.copy(this.planeIntersect);
      this.splashEffect.triggerHandSmash(
        this.renderer,
        this.planeIntersect.x,
        this.planeIntersect.z,
        1.3,
        this.waterSimulation
      );
      this.shark.attractToSplash(this.planeIntersect.x, this.planeIntersect.z, 1.3);
    }
  }

  private triggerPointerDrag(event: MouseEvent | TouchEvent) {
    this.updatePointerCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (this.raycaster.ray.intersectPlane(this.waterPlane, this.planeIntersect)) {
      if (this.planeIntersect.distanceTo(this.lastPointerSplashPos) > 0.16) {
        this.lastPointerSplashPos.copy(this.planeIntersect);
        this.splashEffect.triggerGentleRipple(
          this.renderer,
          this.planeIntersect.x,
          this.planeIntersect.z,
          this.waterSimulation,
          0.035
        );
        this.shark.attractToSplash(this.planeIntersect.x, this.planeIntersect.z, 0.5);
      }
    }
  }

  isShadowEnabled(): boolean {
    return false;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(5.5, 1.4, 7.5);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, -0.6, 0);
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
    const delta = Math.min(this.clock.getDelta(), 0.08);
    this.elapsedTime += delta;

    // Immersion blending (smoothstep between above and below water surface)
    const cameraY = this.camera.position.y;
    const wasUnderwater = this.cameraIsUnderwater;
    const isUnderwaterNow = cameraY < 0.0;
    this.cameraIsUnderwater = isUnderwaterNow;

    if (!wasUnderwater && isUnderwaterNow) {
      this.underwaterAudioHandler.playFromStart();
    }

    const targetUnderwater = MathUtils.clamp(MathUtils.smoothstep(-cameraY, -0.15, 0.25), 0, 1);
    this.underwaterMix = MathUtils.damp(this.underwaterMix, targetUnderwater, 8.0, delta);

    // Fog transitions
    if (this.underwaterMix > 0.001) {
      const depthFactor = MathUtils.clamp(-cameraY * 0.15, 0, 1);
      const targetFogColor = new Color().lerpColors(
        this.shallowUnderwaterFogColor,
        this.deepUnderwaterFogColor,
        depthFactor
      );
      this.currentFogColor.lerpColors(this.aboveWaterFogColor, targetFogColor, this.underwaterMix);
      (this.scene.fog as FogExp2).density = MathUtils.lerp(0.002, 0.055, this.underwaterMix);
    } else {
      this.currentFogColor.copy(this.aboveWaterFogColor);
      (this.scene.fog as FogExp2).density = 0.002;
    }
    (this.scene.fog as FogExp2).color.copy(this.currentFogColor);
    (this.scene.background as Color).copy(this.currentFogColor);

    // Audio volume crossfading
    if (this.isAudioStarted) {
      this.surfaceAudioHandler.setGain(Math.pow(1.0 - this.underwaterMix, 1.8));
      this.underwaterAudioHandler.setGain(Math.pow(this.underwaterMix, 1.4));
    }

    // Update sky and abyss dome
    this.sky.update(this.elapsedTime, this.camera);
    this.abyssDome.update(
      this.elapsedTime,
      this.underwaterMix,
      this.camera,
      this.currentFogColor,
      this.shallowUnderwaterFogColor,
      this.deepUnderwaterFogColor
    );

    // Update shark patrol and fish flocking with surface ripple interactions
    const addSurfaceRipple = (worldX: number, worldZ: number, strength: number, radius: number) => {
      if (Math.abs(worldX) < SIMULATION_RADIUS && Math.abs(worldZ) < SIMULATION_RADIUS) {
        this.waterSimulation.addDrop(
          this.renderer,
          worldX / SIMULATION_RADIUS,
          worldZ / SIMULATION_RADIUS,
          radius,
          strength
        );
      }
    };

    this.shark.update(
      delta,
      this.elapsedTime,
      this.underwaterMix,
      this.waterTexture,
      this.causticsTexture,
      this.sunDirection,
      addSurfaceRipple,
      this.currentFogColor,
      this.camera
    );

    this.fishSchools.update(
      this.elapsedTime,
      this.underwaterMix,
      this.camera,
      this.waterTexture,
      this.causticsTexture,
      this.sunDirection,
      this.shark.position,
      this.shark.velocity,
      addSurfaceRipple,
      this.currentFogColor
    );

    // Update group of sting rays roaming near sea floor
    this.stingRays.update(
      this.elapsedTime,
      delta,
      this.underwaterMix,
      this.causticsTexture,
      this.sunDirection,
      this.currentFogColor,
      this.camera
    );

    // Update seabed & marine snow
    this.seabed.update(
      this.elapsedTime,
      this.underwaterMix,
      this.waterTexture,
      this.causticsTexture,
      this.sunDirection,
      this.currentFogColor
    );

    // Update water surface mesh
    this.waterMesh.update(
      this.waterTexture,
      this.causticsTexture,
      this.sunDirection,
      this.elapsedTime,
      this.underwaterMix,
      this.currentFogColor
    );

    // Update splash droplets and foam rings
    this.splashEffect.update(delta, this.renderer, this.waterSimulation);

    // Subtle ambient drops (e.g. gentle splashes in water)
    this.ambientDropTimer += delta;
    if (this.ambientDropTimer > 0.5) {
      this.ambientDropTimer = 0;
      const randX = (Math.random() - 0.5) * 12.0;
      const randZ = (Math.random() - 0.5) * 12.0;
      this.waterSimulation.addDrop(
        this.renderer,
        randX / SIMULATION_RADIUS,
        randZ / SIMULATION_RADIUS,
        0.0075,
        0.02
      );
    }
  }

  postUpdate() {
    // Step GPU simulation and generate caustics
    if (this.waterSimulation && this.caustics) {
      this.waterSimulation.stepSimulation(this.renderer);
      this.waterSimulation.updateNormals(this.renderer);
      this.waterTexture = this.waterSimulation.texture.texture;

      this.caustics.update(this.renderer, this.waterTexture, this.sunDirection);
      this.causticsTexture = this.caustics.texture.texture;

      this.renderer.setRenderTarget(null);
    }
  }

  // Hand tracking gesture & smash splash handler (VR hand smash splash effect)
  handleGesture(gesture: HandTrackingResult) {
    if (gesture && gesture.position) {
      const now = performance.now();
      const posX = gesture.position.x;
      const posY = gesture.position.y;
      const posZ = gesture.position.z;

      // Compute downward smash velocity
      let vy = 0;
      if (this.hasPrevHandPosition) {
        vy = posY - this.prevHandPosition.y;
      }
      this.prevHandPosition.set(posX, posY, posZ);
      this.hasPrevHandPosition = true;

      const isNearWater = posY > -0.25 && posY < 0.25;
      const isOpenHand = gesture.gestureType === GestureType.Open_Hand;
      const isSmashingDown = vy < -0.015 && posY <= 0.08;

      if (isNearWater && (isOpenHand || isSmashingDown)) {
        if (now - this.lastHandSmashTime > 160) {
          this.lastHandSmashTime = now;
          const smashSpeed = Math.abs(vy) * 60;
          const intensity = isOpenHand
            ? MathUtils.clamp(smashSpeed * 1.5, 1.1, 2.2)
            : MathUtils.clamp(smashSpeed * 1.8, 0.8, 2.0);
          this.splashEffect.triggerHandSmash(
            this.renderer,
            posX,
            posZ,
            intensity,
            this.waterSimulation
          );
          this.shark.attractToSplash(posX, posZ, intensity);
        }
      } else if (isNearWater && gesture.gestureType !== GestureType.None) {
        // Dragging or moving hand gently through water
        if (now - this.lastHandSmashTime > 100) {
          this.lastHandSmashTime = now;
          this.splashEffect.triggerGentleRipple(
            this.renderer,
            posX,
            posZ,
            this.waterSimulation,
            0.025
          );
          this.shark.attractToSplash(posX, posZ, 0.4);
        }
      }
      this.latestGesture = gesture.gestureType;
    }
  }
}
