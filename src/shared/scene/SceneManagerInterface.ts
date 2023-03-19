import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three/src/Three';
import PhysicsHandler from '../physics/PhysicsHandler';

export enum GestureType {
  "openHand",
  "stopHand"
}

export interface SceneManagerInterface {
  build(
    camera: PerspectiveCamera,
    scene: Scene,
    renderer: WebGLRenderer,
    physicsHandler: PhysicsHandler
  );

  update();

  postUpdate();

  handleGesture(gesture: GestureType)

  getInitialCameraAngle(): number;

  getInitialCameraPosition(): Vector3;
}
