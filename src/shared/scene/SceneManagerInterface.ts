import { PerspectiveCamera, Quaternion, Scene, ToneMapping, Vector3, WebGLRenderer } from 'three/src/Three';
import PhysicsHandler from '../physics/cannon/PhysicsHandler';
import AmmoHandler from "../physics/ammo/AmmoHandler";

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
  position: Vector3
  orientation: Quaternion
}

export enum PostProcessingType {
  "Bloom"
}

export interface PostProcessingConfig {
  postProcessingType: PostProcessingType
  toneMapping: ToneMapping
  threshold: number,
  strength: number,
  radius: number,
  exposure: number
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

  getPostProcessingConfig(): PostProcessingConfig;

  setAmmoHandler(ammoHandler: AmmoHandler);

}
