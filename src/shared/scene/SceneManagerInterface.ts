import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import PhysicsHandler from '../physics/physicsHandler';
import { XRReferenceSpace } from '../../webxr/WebXRDeviceAPI';

export interface SceneManagerInterface {
  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler);
  update();
  // setXrReferenceSpace(space: XRReferenceSpace): void;
  // getXrReferenceSpace(): XRReferenceSpace;
}
