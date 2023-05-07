import { AnimationMixer, Clock, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three/src/Three';
import { GestureType, HandTrackingResult, SceneManagerInterface } from './SceneManagerInterface';
import PhysicsHandler from '../physics/PhysicsHandler';
import { SceneHelper } from './SceneHelper';
import HandPoseManager from '../hands/HandPoseManager';

export default class SceneManagerParent implements SceneManagerInterface {
  protected scene: Scene;
  protected sceneHelper: SceneHelper;
  protected physicsHandler: PhysicsHandler;
  protected renderer: WebGLRenderer;
  protected camera: PerspectiveCamera;
  protected handPoseManager: HandPoseManager;
  protected clock = new Clock();
  protected mixer: AnimationMixer;

  build(camera, scene, renderer, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.physicsHandler = physicsHandler;
    this.renderer = renderer;
    this.camera = camera;
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition() {
    return undefined;
  }

  handleGesture(gesture: HandTrackingResult) {
  }

  postUpdate() {
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
    }
  }

}
