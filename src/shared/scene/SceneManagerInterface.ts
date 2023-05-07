import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three/src/Three';
import PhysicsHandler from '../physics/PhysicsHandler';

export enum GestureType {
  "None",
  "Open_Hand",
  "Closed_Hand",
  "Index_Thumb",
  "Middle_Thumb",
  "Ring_Thumb",
  "Pinky_Thumb",
  "Middle_and_Ring_on_Thumb"
}

export interface HandTrackingResult {
  gestureType: GestureType
  position: Vector3;
  orientation: Quaternion;
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

  handleGesture(gesture: HandTrackingResult)

  getInitialCameraAngle(): number;

  getInitialCameraPosition(): Vector3;
}
