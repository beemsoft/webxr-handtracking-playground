import {
  Color,
  FogExp2,
  HemisphereLight,
  MathUtils,
  NeutralToneMapping,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import { XRFrameOfReference, XRReferenceSpace } from '../../../../shared/webxr/WebXRDeviceAPI';
import { CausticField, WATER_HEIGHT } from './CausticField';
import { Rotunda } from './Rotunda';
import { apertureOf, WATER_DEFAULTS, WaterSurface } from './Water';
import { LightShafts } from './LightShafts';
import { Marine } from './Marine';
import { Motes } from './Motes';
import { DiverGlove, GloveJoint } from './DiverGlove';
import { Shark } from './Shark';
import { StingRays } from './StingRays';

const AUTO_RIPPLE_INTERVAL = 11;
const MAX_FRAME_STEP = 0.05;

/**
 * Port of mrdoob's Codevember 2026 #10 "Caustic" to WebGL: a sunken stone observatory lit by
 * refracted sunlight. The WebGPU compute photon map becomes a vertex-shader photon grid
 * (CausticField); the reflective glass sphere of the original is intentionally left out, so only
 * the water, the stone, the fish, the plants and the drifting motes remain. A curious shark and
 * a few sting rays from the webgl_water_ocean demo share the room: the fish scatter from the
 * shark and the camera, the shark plays at biting the viewer and the rays roam the floor.
 *
 * The scene is built synchronously and contains no device branching: the XR managers drive the
 * camera. The caustic map is rendered in update(), before the XR layer framebuffer is bound.
 */
export default class SceneManager extends SceneManagerParent {
  private field?: CausticField;
  private rotunda?: Rotunda;
  private water?: WaterSurface;
  private shafts?: LightShafts;
  private marine?: Marine;
  private shark?: Shark;
  private rays?: StingRays;
  private motes?: Motes;
  private gloves?: { left: DiverGlove; right: DiverGlove };
  private readonly gloveJoint: GloveJoint = { x: 0, y: 0, z: 0, radius: 0 };

  private readonly surfaceAudioHandler = new AudioHandler();
  private readonly underwaterAudioHandler = new AudioHandler();
  private surfaceAudioElement?: HTMLAudioElement;
  private underwaterAudioElement?: HTMLAudioElement;
  private isAudioStarted = false;
  private underwaterMix = 1;

  private waterTime = 0;
  private paused = false;
  private nextAutoRipple = 4;
  private lastPauseToggle = 0;
  private readonly raycaster = new Raycaster();
  private readonly waterPlane = new Plane(new Vector3(0, 1, 0), -WATER_HEIGHT);
  private readonly hit = new Vector3();

  isDepthEnabled(): boolean {
    return false;
  }

  isShadowEnabled(): boolean {
    // The sun reaches the room only through the caustic map; no shadow pass is needed.
    return false;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 2.0, 11);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 2.65, 0);
  }

  getInitialCameraAngle(): number {
    const pos = this.getInitialCameraPosition();
    const target = this.getInitialCameraTarget();
    return Math.atan2(target.x - pos.x, -(target.z - pos.z));
  }

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = false;

    this.scene.background = new Color(WATER_DEFAULTS.fogColor);
    this.scene.fog = new FogExp2(WATER_DEFAULTS.fogColor.getHex(), 0.062);

    // Soft scattered skylight; the direct sun comes from the caustic map.
    const ambient = new HemisphereLight(new Color(0.2, 0.45, 0.5), new Color(0.05, 0.12, 0.13), 2.2);
    this.scene.add(ambient);

    this.field = new CausticField(renderer);
    const aperture: Vector2 = apertureOf(this.field.sunDirection);

    this.rotunda = new Rotunda(this.field);
    this.scene.add(this.rotunda.group);

    this.marine = new Marine(this.field);
    this.scene.add(this.marine.group);

    this.shark = new Shark(this.field);
    this.scene.add(this.shark.group);

    this.rays = new StingRays(this.field);
    this.scene.add(this.rays.group);

    this.water = new WaterSurface(this.field, aperture);
    this.scene.add(this.water.mesh);

    this.shafts = new LightShafts(this.field, aperture);
    this.scene.add(this.shafts.mesh);

    this.motes = new Motes(this.field, aperture);
    this.scene.add(this.motes.points);

    // Diver's gloves replace the default joint boxes in VR; hidden until a hand is tracked.
    this.gloves = { left: new DiverGlove(this.field), right: new DiverGlove(this.field) };
    this.scene.add(this.gloves.left.group, this.gloves.right.group);

    this.field.update(this.waterTime);
    this.marine.update(this.waterTime, 0, this.camera.position, this.shark);

    this.registerDesktopControls();
    this.initAudio();
  }

  /** Underwater hum while the camera is below the surface, the ocean loop above it (as in the other ocean demos). */
  private initAudio() {
    this.surfaceAudioHandler.initAudio(AudioDemo.ocean);
    this.surfaceAudioElement = this.surfaceAudioHandler.audioElement;
    if (this.surfaceAudioElement) this.surfaceAudioElement.loop = true;

    const sharedContext = this.surfaceAudioHandler.getAudioContext();
    this.underwaterAudioHandler.initAudio(AudioDemo.underwater, undefined, sharedContext);
    this.underwaterAudioElement = this.underwaterAudioHandler.audioElement;
    if (this.underwaterAudioElement) this.underwaterAudioElement.loop = true;

    this.surfaceAudioHandler.setGain(0);
    this.underwaterAudioHandler.setGain(1);
    this.startAudio();
  }

  private startAudio() {
    if (this.isAudioStarted) return;
    const playAll = () => {
      const promises: Promise<void>[] = [];
      if (this.surfaceAudioElement) promises.push(this.surfaceAudioElement.play());
      if (this.underwaterAudioElement) promises.push(this.underwaterAudioElement.play());
      return Promise.all(promises);
    };

    playAll()
      .then(() => {
        this.isAudioStarted = true;
      })
      .catch(() => {
        // Autoplay is blocked until the first user gesture.
        const resumeAudio = () => {
          window.removeEventListener('click', resumeAudio);
          window.removeEventListener('touchstart', resumeAudio);
          if (this.isAudioStarted) return;
          this.surfaceAudioHandler.resume();
          this.underwaterAudioHandler.resume();
          playAll()
            .then(() => {
              this.isAudioStarted = true;
            })
            .catch(() => {});
        };
        window.addEventListener('click', resumeAudio);
        window.addEventListener('touchstart', resumeAudio);
      });
  }

  private updateAudio(delta: number) {
    if (!this.isAudioStarted) return;
    const target = this.camera.position.y < WATER_HEIGHT ? 1 : 0;
    this.underwaterMix = MathUtils.damp(this.underwaterMix, target, 6, delta);
    this.surfaceAudioHandler.setGain(Math.pow(1 - this.underwaterMix, 1.8));
    this.underwaterAudioHandler.setGain(Math.pow(this.underwaterMix, 1.4));
  }

  /** WebXR hand tracking: pose a neoprene diver's glove over each tracked hand. */
  updateHands(frame: XRFrameOfReference, referenceSpace: XRReferenceSpace) {
    if (!this.gloves) return;
    const seen = { left: false, right: false };
    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      if (!hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      const joint = this.gloveJoint;
      this.gloves[source.handedness].update((name) => {
        const space = hand.get(name);
        const pose = space ? frame.getJointPose(space, referenceSpace) : null;
        if (!pose) return null;
        joint.x = pose.transform.position.x;
        joint.y = pose.transform.position.y;
        joint.z = pose.transform.position.z;
        joint.radius = pose.radius ?? 0.008;
        return joint;
      });
      seen[source.handedness] = true;
    }
    if (!seen.left) this.gloves.left.hide();
    if (!seen.right) this.gloves.right.hide();
  }

  update() {
    super.update();
    if (!this.field || !this.marine || !this.shark || !this.rays) return;

    const delta = Math.min(this.timer.getDelta(), MAX_FRAME_STEP);
    this.updateAudio(delta);
    if (!this.paused) {
      this.waterTime += delta;
      if (this.waterTime >= this.nextAutoRipple) {
        // Without the original's floating sphere, a drop from above stirs the water instead.
        this.nextAutoRipple = this.waterTime + AUTO_RIPPLE_INTERVAL;
        this.ripple(MathUtils.randFloatSpread(1.5), MathUtils.randFloatSpread(1.5), 0.2);
      }
    }

    // Offscreen pre-pass: must run before the XR layer framebuffer is bound for the eye render.
    this.field.update(this.waterTime);

    // Creatures react to the viewer's head; they freeze together with the water while paused.
    const step = this.paused ? 0 : delta;
    const head = this.camera.position;
    this.shark.update(step, this.waterTime, head);
    this.rays.update(step, this.waterTime, head, this.shark.position);
    this.marine.update(this.waterTime, step, head, this.shark);
  }

  /** Drop a ripple onto the water surface at world (x, z). */
  ripple(x: number, z: number, strength = 0.13) {
    if (!this.field) return;
    this.field.rippleAt(MathUtils.clamp(x, -7, 7), MathUtils.clamp(z, -7, 7), this.waterTime, strength);
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  handleGesture(gesture: HandTrackingResult) {
    const now = performance.now();
    if (gesture.gestureType === GestureType.Open_Hand && now - this.lastPauseToggle > 600) {
      this.lastPauseToggle = now;
      if (this.paused) this.paused = false;
      this.ripple(gesture.position.x, gesture.position.z);
    } else if (gesture.gestureType === GestureType.Closed_Hand && now - this.lastPauseToggle > 1200) {
      this.lastPauseToggle = now;
      this.togglePause();
    }
  }

  private registerDesktopControls() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;

    canvas.addEventListener('dblclick', (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.waterPlane, this.hit)) {
        if (this.paused) this.paused = false;
        this.ripple(this.hit.x, this.hit.z);
      }
    });

    window.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        this.togglePause();
      } else if (event.code === 'KeyR') {
        if (this.paused) this.paused = false;
        this.ripple(0, 0);
      }
    });
  }
}
