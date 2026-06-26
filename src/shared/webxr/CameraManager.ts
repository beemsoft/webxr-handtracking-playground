import { ArrayCamera, PerspectiveCamera, Vector4 } from 'three';
import { XRDevicePose, XRView, XRViewport } from './WebXRDeviceAPI';

const FIELD_OF_VIEW_DEGREES = 75;

export default class CameraManager {
  private cameraL = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.1, 100);
  private cameraR = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.1, 100);
  public cameraVR = new ArrayCamera([this.cameraL, this.cameraR]);

  public createVrCamera() {
    this.cameraL.matrixAutoUpdate = false;
    this.cameraR.matrixAutoUpdate = false;
    this.cameraVR.matrixAutoUpdate = false;
    this.cameraVR.frustumCulled = false;
    this.cameraL.layers.enable(1);
    // @ts-ignore
    this.cameraL.viewport = new Vector4();
    this.cameraR.layers.enable(2);
    // @ts-ignore
    this.cameraR.viewport = new Vector4();
    this.cameraVR.layers.enable(1);
    this.cameraVR.layers.enable(2);
    this.cameraVR.fov = FIELD_OF_VIEW_DEGREES;
  }

  public updateArrayCamera(index: number, view: XRView, viewport: XRViewport) {
    // console.log('Update camera ' + index);
    let viewMatrix = view.transform.inverse.matrix;
    let camera = this.cameraVR.cameras[index];
    // console.log('Projection matrix: ' + JSON.stringify(camera.projectionMatrix));
    camera.projectionMatrix.fromArray(view.projectionMatrix);
    camera.matrixWorldInverse.fromArray(viewMatrix);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    // @ts-ignore
    camera.viewport.set(viewport.x, viewport.y, viewport.width, viewport.height);
  }

  public update(pose: XRDevicePose) {
    if (!pose) return;
    this.cameraVR.position.x = pose.transform.position.x;
    this.cameraVR.position.y = pose.transform.position.y;
    this.cameraVR.position.z = pose.transform.position.z;
    this.cameraVR.quaternion.x = pose.transform.orientation.x;
    this.cameraVR.quaternion.y = pose.transform.orientation.y;
    this.cameraVR.quaternion.z = pose.transform.orientation.z;
    this.cameraVR.quaternion.w = pose.transform.orientation.w;
    this.cameraVR.updateMatrixWorld(true);
    // Explicitly update sub-cameras world matrix as they are removed from normal scene graph logic
    for (let camera of this.cameraVR.cameras) {
      camera.updateMatrixWorld(true);
    }
    this.cameraVR.updateProjectionMatrix();
  }

}
