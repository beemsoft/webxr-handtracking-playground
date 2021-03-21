import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import PhysicsHandler from '../physics/physicsHandler';

export enum GestureType {
  "openHand"
}

export interface SceneManagerInterface {
  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler);
  update();
  handleGesture(gesture: GestureType)
}
