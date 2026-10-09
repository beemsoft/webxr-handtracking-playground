import {
  DirectionalLight,
  PerspectiveCamera,
  Scene,
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
import { Shorebed } from './Shorebed';
import { BreakerEvent } from './BreakerWave';

export default class SceneManager extends SceneManagerParent {
  private ocean: RollingWaterSurface;
  private lipRibbon: LipRibbon;
  private shorebed: Shorebed;
  private sky: Sky;
  private sun: Vector3 = new Vector3();
  private pmremGenerator: PMREMGenerator;
  private palmLeaves: Group[] = [];
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private isAudioStarted: boolean = false;

  private breakerEvents: BreakerEvent[] = [];
  private nextEventIndex: number = 0;
  private waveCycleDuration: number = 18.0; // Seconds per sequence loop

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
    // Scheduled wave events calibrated from ShoreBreak (Z, A, a, B, C, D)
    this.breakerEvents = [
      { name: 'A', t0: 1.5, H: 0.65, zI: -1.8, c: 2.6, x0: 0.0, seed: 0.37, hPeel: 0.15, stand: 0.0, kappa: 0.0, wobble: 0.012, waviness: 0.03, tilt: 0.0, hvar: 0.08, style: 1.0, spill: 0.2, strength: 1.0, bore: 1.0, splash: 1.0, farPhase: 0.18 },
      { name: 'B', t0: 5.5, H: 0.85, zI: -1.9, c: 2.8, x0: 0.0, seed: 0.73, hPeel: 0.22, stand: 0.0, kappa: 0.0, wobble: 0.015, waviness: 0.04, tilt: 0.0, hvar: 0.10, style: 1.0, spill: 0.1, strength: 1.0, bore: 1.0, splash: 1.0, farPhase: 0.83 },
      { name: 'C', t0: 9.8, H: 0.55, zI: -2.0, c: 2.4, x0: -1.5, seed: 0.29, hPeel: -0.15, stand: 0.3, kappa: -0.1, wobble: 0.012, waviness: 0.03, tilt: 0.02, hvar: 0.08, style: 0.5, spill: 0.8, strength: 0.9, bore: 0.9, splash: 0.9, farPhase: 0.36 },
      { name: 'D', t0: 14.0, H: 0.75, zI: -1.75, c: 2.7, x0: 1.2, seed: 0.91, hPeel: 0.10, stand: 0.0, kappa: 0.0, wobble: 0.014, waviness: 0.03, tilt: -0.01, hvar: 0.09, style: 1.0, spill: 0.2, strength: 1.0, bore: 1.0, splash: 1.0, farPhase: 0.05 },
    ];
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

    // Loop active breaker events dynamically across continuous time
    const activeEvents: BreakerEvent[] = this.breakerEvents.map(evt => {
      const period = this.waveCycleDuration;
      const cycleTime = time % period;
      let shiftedT0 = evt.t0;

      // Keep event active relative to repeating cycle
      const dt = cycleTime - evt.t0;
      if (dt < -3.0) {
        shiftedT0 += period;
      }

      return {
        ...evt,
        t0: shiftedT0
      };
    });

    if (this.ocean) {
      this.ocean.updateUniforms(time % this.waveCycleDuration, activeEvents);
    }
    if (this.lipRibbon) {
      this.lipRibbon.updateUniforms(time % this.waveCycleDuration, activeEvents);
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
