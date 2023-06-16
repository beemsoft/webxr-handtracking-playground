import { AnimationMixer, Clock, PerspectiveCamera, Scene, WebGLRenderer } from 'three/src/Three';
import { HandTrackingResult, PostProcessingConfig, SceneManagerInterface } from './SceneManagerInterface';
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

  getPostProcessingConfig(): PostProcessingConfig {
    return undefined;
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
    }
  }

}
