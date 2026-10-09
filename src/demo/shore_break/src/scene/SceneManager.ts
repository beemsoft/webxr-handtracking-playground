import {
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  MeshStandardMaterial,
  Mesh,
  AmbientLight,
  Color,
  CylinderGeometry,
  SphereGeometry,
  ACESFilmicToneMapping,
  MathUtils,
  PMREMGenerator,
  Group
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { Sky } from '../../../../shared/scene/sky/Sky';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { GestureType, HandTrackingResult, PostProcessingConfig } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { RollingWaterSurface } from './RollingWaterSurface';
import { LipRibbon } from './LipRibbon';
import { SplashParticles } from './SplashParticles';
import { Shorebed } from './Shorebed';
import { BreakerEvent } from './BreakerWave';

export default class SceneManager extends SceneManagerParent {
  private ocean: RollingWaterSurface;
  private lipRibbon: LipRibbon;
  private splash: SplashParticles;
  private shorebed: Shorebed;
  private sky: Sky;
  private sun: Vector3 = new Vector3();
  private drawingBufferSize: Vector2 = new Vector2();
  private pmremGenerator: PMREMGenerator;
  private palmLeaves: Group[] = [];
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private isAudioStarted: boolean = false;

  // Endless wave train: events are generated ahead of time from a seeded PRNG and dropped once
  // their swash has run out, so the surf never visibly loops or resets.
  private breakerEvents: BreakerEvent[] = [];
  private nextEventIndex: number = 0;
  private lastT0: number = 0.0;
  private rngState: number = 0x2f6e2b1;
  private static readonly EVENT_LEAD = 8.0;   // s before impact an event must be scheduled (shoaling swell visible from ~6 s)
  private static readonly EVENT_TAIL = 11.0;  // s after impact until the bore / swash have faded

  private parameters = {
    elevation: 25.0,
    azimuth: 165.0
  };

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.toneMapping = ACESFilmicToneMapping;
    this.pmremGenerator = new PMREMGenerator(renderer);

    this.scene.background = new Color(0x87ceeb);

    const ambientLight = new AmbientLight(0xffffff, 0.4);
    ambientLight.name = 'AmbientLight';
    this.scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xfffaed, 2.8);
    dirLight.name = 'SunLight';
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 300;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    this.initWaveSchedule();
    this.addShorebed();
    this.addOcean();
    this.addSky();
    this.addScenery();
    this.addPalmTree();

    this.audioHandler.initAudio(AudioDemo.ocean);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;

    this.startAudio();
  }

  private initWaveSchedule() {
    this.breakerEvents = [];
    this.nextEventIndex = 0;
    this.lastT0 = 1.5 - this.nextInterval();
    this.fillWaveSchedule(0.0);
  }

  // Deterministic LCG in [0, 1) so the wave train is the same on every run
  private rand(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  private randRange(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  // Wave period 3.6-5.4 s, occasionally a longer lull between sets
  private nextInterval(): number {
    const lull = this.rand() < 0.12 ? this.randRange(1.5, 3.0) : 0.0;
    return this.randRange(3.6, 5.4) + lull;
  }

  // One breaker calibrated around the ShoreBreak presets (Z, A, a, B, C, D): heights follow a slow
  // set/lull envelope over ~7 waves with per-wave scatter; mostly plunging barrels with the
  // occasional smaller spilling wave. `far` is the along-shore timing modulation amplitude (s):
  // with |farS| <= 1 the first and last sections of a crest break 2*far s apart, so the break
  // closes out diagonally in sections; each event gets its own phase so the peak falls elsewhere.
  private makeEvent(t0: number, index: number): BreakerEvent {
    const setEnv = 0.5 + 0.5 * Math.sin(index * 0.9 + 0.4 * Math.sin(index * 0.37));
    const spilling = this.rand() < 0.22;
    const H = spilling
      ? this.randRange(0.5, 0.62)
      : MathUtils.clamp(0.58 + 0.3 * setEnv + this.randRange(-0.07, 0.07), 0.55, 0.9);
    const style = spilling ? this.randRange(0.4, 0.6) : this.randRange(0.9, 1.0);
    const amp = spilling ? 0.9 : 1.0;
    return {
      name: 'W' + index,
      t0,
      H,
      zI: this.randRange(-2.05, -1.7),
      c: 2.3 + 0.6 * (H - 0.5) / 0.4 + this.randRange(-0.1, 0.1),
      x0: this.randRange(-1.5, 1.5),
      seed: this.rand(),
      hPeel: this.randRange(-0.15, 0.22),
      stand: spilling ? 0.3 : 0.0,
      kappa: spilling ? -0.1 : 0.0,
      wobble: this.randRange(0.011, 0.016),
      waviness: this.randRange(0.03, 0.04),
      tilt: this.randRange(-0.015, 0.02),
      hvar: this.randRange(0.08, 0.1),
      style,
      spill: spilling ? 0.8 : this.randRange(0.1, 0.2),
      strength: amp,
      bore: amp,
      splash: amp,
      farPhase: this.rand(),
      far: this.randRange(0.3, 0.5),
    };
  }

  // Keep events scheduled EVENT_LEAD s ahead and drop those whose swash has run out
  private fillWaveSchedule(time: number) {
    while (this.lastT0 < time + SceneManager.EVENT_LEAD) {
      this.lastT0 += this.nextInterval();
      this.breakerEvents.push(this.makeEvent(this.lastT0, this.nextEventIndex++));
    }
    this.breakerEvents = this.breakerEvents.filter(e => time - e.t0 < SceneManager.EVENT_TAIL);
  }

  private addShorebed() {
    this.shorebed = new Shorebed();
    this.scene.add(this.shorebed);
  }

  private addOcean() {
    this.ocean = new RollingWaterSurface();
    this.scene.add(this.ocean);

    this.lipRibbon = new LipRibbon();
    this.scene.add(this.lipRibbon);

    // impact splash-up (one point-cloud draw call driven by the same event schedule)
    this.splash = new SplashParticles();
    this.scene.add(this.splash);
  }

  private addSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);

    const skyUniforms = this.sky.material.uniforms;
    this.sky.name = 'Sky';
    skyUniforms['turbidity'].value = 8;
    skyUniforms['rayleigh'].value = 1.5;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    this.updateSun();
  }

  private updateSun() {
    const phi = MathUtils.degToRad(90 - this.parameters.elevation);
    const theta = MathUtils.degToRad(this.parameters.azimuth);

    this.sun.setFromSphericalCoords(1, phi, theta);

    this.sky.material.uniforms['sunPosition'].value.copy(this.sun);
    if (this.ocean) {
      (this.ocean.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }
    if (this.lipRibbon) {
      (this.lipRibbon.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }
    if (this.splash) {
      (this.splash.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }
    if (this.shorebed) {
      (this.shorebed.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }

    this.scene.environment = this.pmremGenerator.fromScene(this.sky).texture;

    this.scene.children.forEach((obj) => {
      if (obj.name === 'SunLight' && obj instanceof DirectionalLight) {
        obj.position.copy(this.sun).multiplyScalar(100);
        obj.lookAt(0, 0, 0);
      }
    });
  }

  private addScenery() {
    const rockMat = new MeshStandardMaterial({ color: 0x6e6862, roughness: 0.85, metalness: 0.1 });

    // Shoreline coastal rocks placed along the sides of the beach
    const rockPositions = [
      { x: -16, y: -0.2, z: -2.0, r: 2.2 },
      { x: -18, y: 0.4, z: 0.5, r: 3.1 },
      { x: -14, y: -0.5, z: -5.0, r: 1.8 },
      { x: 17, y: -0.1, z: -1.5, r: 2.5 },
      { x: 19, y: 0.6, z: 1.2, r: 3.4 },
      { x: 15, y: -0.4, z: -4.5, r: 2.0 },
    ];

    rockPositions.forEach((p, idx) => {
      const geom = new SphereGeometry(p.r, 8, 6);
      const rock = new Mesh(geom, rockMat);
      rock.name = `Rock_${idx}`;
      rock.scale.set(1.4, 0.6, 1.1);
      rock.rotation.set(0.3, idx * 0.8, -0.2);
      rock.position.set(p.x, p.y, p.z);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    });
  }

  private addPalmTree() {
    const palmGroup = new Group();
    palmGroup.name = 'PalmTree';

    const trunkMat = new MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
    const trunkSegments = 6;
    const trunkHeight = 8;
    const segmentHeight = trunkHeight / trunkSegments;

    let currentY = 0;
    for (let i = 0; i < trunkSegments; i++) {
      const radiusTop = 0.35 - (i * 0.03);
      const radiusBottom = 0.42 - (i * 0.03);
      const segmentGeom = new CylinderGeometry(radiusTop, radiusBottom, segmentHeight, 6);
      const segment = new Mesh(segmentGeom, trunkMat);
      segment.position.y = currentY + segmentHeight / 2;
      segment.rotation.z = Math.sin(i * 0.4) * 0.12;
      segment.position.x = Math.sin(i * 0.4) * 0.3;
      segment.castShadow = true;
      segment.receiveShadow = true;
      palmGroup.add(segment);
      currentY += segmentHeight;
    }

    const leafMat = new MeshStandardMaterial({ color: 0x277724, roughness: 0.7, side: 2 });
    const leafCount = 8;
    const leafSegments = 5;
    const leafSegmentLength = 1.0;

    for (let i = 0; i < leafCount; i++) {
      const leafGroup = new Group();
      leafGroup.position.y = trunkHeight;
      leafGroup.rotation.y = (i / leafCount) * Math.PI * 2;

      let currentLeafY = 0;
      let currentLeafZ = 0;

      for (let j = 0; j < leafSegments; j++) {
        const radius = 0.35 * (1 - j / leafSegments);
        const leafSegGeom = new CylinderGeometry(radius, radius * 1.2, leafSegmentLength, 4);
        const segment = new Mesh(leafSegGeom, leafMat);

        segment.position.z = currentLeafZ + leafSegmentLength / 2;
        segment.position.y = currentLeafY;

        const tilt = (j / leafSegments) * 0.55;
        segment.rotation.x = Math.PI / 2 + tilt;
        segment.castShadow = true;
        segment.receiveShadow = true;
        leafGroup.add(segment);

        currentLeafZ += Math.cos(tilt) * leafSegmentLength;
        currentLeafY -= Math.sin(tilt) * leafSegmentLength;
      }

      palmGroup.add(leafGroup);
      this.palmLeaves.push(leafGroup);
    }

    // Position on upper beach berm (z = 8m, x = -8m)
    palmGroup.position.set(-8, 1.2, 8);
    this.scene.add(palmGroup);
  }

  update() {
    super.update();
    const time = this.timer.getElapsed();

    // Continuous, never-looping wave train: time is passed unwrapped (a wrapped time made the
    // swell, ripple and caustic phases jump every cycle) and the event list is refilled ahead.
    this.fillWaveSchedule(time);
    const activeEvents = this.breakerEvents;

    if (this.ocean) {
      this.ocean.updateUniforms(time, activeEvents);
    }
    if (this.lipRibbon) {
      this.lipRibbon.updateUniforms(time, activeEvents);
    }
    if (this.splash) {
      let viewportHeight: number | undefined;
      if (this.renderer) {
        this.renderer.getDrawingBufferSize(this.drawingBufferSize);
        viewportHeight = this.drawingBufferSize.y;
      }
      this.splash.updateUniforms(time, activeEvents, viewportHeight);
    }
    if (this.shorebed) {
      this.shorebed.setTime(time);
    }

    if (this.camera) {
      this.audioHandler.setVolume(this.camera.position);
    }

    // Gentle palm leaf breeze animation
    this.palmLeaves.forEach((leaf, i) => {
      const wave = Math.sin(time * 1.5 + i * 0.5) * 0.04;
      const wave2 = Math.cos(time * 1.0 + i * 0.8) * 0.02;
      leaf.rotation.x = wave;
      leaf.rotation.z = wave2;
    });
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAudioStarted && this.handPoseManager.isOpenHand()) {
        this.startAudio();
      }
    }
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return undefined;
  }

  isDepthEnabled(): boolean {
    return false;
  }

  isShadowEnabled(): boolean {
    return true;
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      this.startAudio();
    }
  }

  private startAudio() {
    if (!this.isAudioStarted) {
      this.isAudioStarted = true;
      this.audioHandler.resume();
      this.audioElement.play().catch(e => {
        console.warn("Audio play failed:", e);
        this.isAudioStarted = false;
      });
    }
  }

  // Camera placed right on the shoreline water edge (z = 3.5, y = 1.6 standing height) looking directly at the incoming curling breakers (z = -2.0)
  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 1.6, 3.5);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 0.4, -3.0);
  }
}
