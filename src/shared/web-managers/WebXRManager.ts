import { Scene, Vector3, WebGLRenderer } from 'three';
import PhysicsHandler from '../physics/PhysicsHandler';
import { GestureType, SceneManagerInterface } from '../scene/SceneManagerInterface';
import CameraManager from '../webxr/CameraManager';
import { XRDevicePose, XRFrameOfReference, XRReferenceSpace, XRRigidTransform } from '../webxr/WebXRDeviceAPI';
import TrackedHandsManager from '../hands/TrackedHandsManager';

export default class WebXRManager {
  private renderer: WebGLRenderer;
  private gl: WebGLRenderingContext;
  private readonly scene: Scene = new Scene();
  private xrReferenceSpace: XRReferenceSpace = null;
  sessionActive = false;
  inputSourcesAvailable = false;
  private session = null;
  private physicsHandler = new PhysicsHandler();
  private sceneBuilder: SceneManagerInterface;
  private cameraManager = new CameraManager();
  private trackedHandsManager = new TrackedHandsManager(this.scene, this.physicsHandler, this.cameraManager.cameraVR);
  private timestamp = null;

  constructor(sceneBuilder: SceneManagerInterface) {
    this.cameraManager.createVrCamera();
    this.sceneBuilder = sceneBuilder;

    navigator.xr.requestSession('immersive-vr', {optionalFeatures: ["hand-tracking"]})
      .then(session => {
        this.session = session;
        this.initRenderer();
        this.session.requestReferenceSpace('local')
          .then(space => {
            this.xrReferenceSpace = space;
            // this.sceneBuilder.setXrReferenceSpace(space);
          }, error => {
            console.log(error.message);
          })
          .then(() => {
            this.sessionActive = true;
            this.session.requestAnimationFrame(this.onXRFrame);
          })
      })
      .catch(error => {
        console.log(error.message);
      });
  }

  private initRenderer() {
    let glCanvas: HTMLCanvasElement = document.createElement('canvas');
    this.gl = <WebGLRenderingContext>glCanvas.getContext('webgl', {xrCompatible: true});
    this.renderer = new WebGLRenderer({canvas: glCanvas, context: this.gl});
    // @ts-ignore
    this.session.updateRenderState({baseLayer: new XRWebGLLayer(this.session, this.gl)});
  }

  onXRFrame = (timestamp: DOMHighResTimeStamp, frame: XRFrameOfReference) => {
    this.renderer.clear();
    this.setDeltaTime(timestamp);
    let session = frame.session;
    session.requestAnimationFrame(this.onXRFrame);
    if (session.inputSources.length === 0) return;
    let pose = frame.getViewerPose(this.xrReferenceSpace);
    if (!pose) return;
    let layer = session.renderState.baseLayer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, layer.framebuffer);
    let index = 0;
    for (let view of pose.views) {
      let viewport = layer.getViewport(view);
      this.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      this.cameraManager.updateArrayCamera(index, view, viewport);
      index++;
    }
    if (!this.inputSourcesAvailable) {
      if (this.session.inputSources.length == 2) {
        this.sceneBuilder.build(this.cameraManager.cameraVR, this.scene, this.renderer, this.physicsHandler);
        this.inputSourcesAvailable = true;
      }
    } else {
      this.renderScene(frame, pose);
    }
  };

  private setDeltaTime(timestamp: DOMHighResTimeStamp) {
    if (this.timestamp == null) {
      this.timestamp = timestamp;
    } else {
      const delta = timestamp - this.timestamp;
      this.timestamp = timestamp;
      const fps = 1 / (delta / 1000);
      this.physicsHandler.dt = 1 / fps;
    }
  }

  private renderScene(frame: XRFrameOfReference, pose: XRDevicePose) {
    if (this.trackedHandsManager.isTrackedHandAvailable(frame)) {
      let pinchPosition = this.trackedHandsManager.pinchFinger(frame, this.xrReferenceSpace);
      if (pinchPosition) {
        let direction = new Vector3(pinchPosition.x - this.cameraManager.cameraVR.position.x, 0, pinchPosition.z - this.cameraManager.cameraVR.position.z).multiplyScalar(0.1)
        this.moveInDirection(direction);
      }
      if (this.physicsHandler.bodyControlledByHandGesture) {
        this.trackedHandsManager.checkFixedBall(frame, this.xrReferenceSpace);
        this.trackedHandsManager.openHand(frame, this.xrReferenceSpace);
        this.trackedHandsManager.thumbsJoining(frame, this.xrReferenceSpace);
      }
      if (this.trackedHandsManager.isOpenHand(frame, this.xrReferenceSpace)) {
        this.sceneBuilder.handleGesture(GestureType.openHand);
      }
    }
    this.trackedHandsManager.renderHands(frame, pose, this.xrReferenceSpace);
    this.sceneBuilder.update();
    this.cameraManager.update(pose);
    this.physicsHandler.updatePhysics();
    this.renderer.render(this.scene, this.cameraManager.cameraVR);
  }

  private moveInDirection(direction: Vector3) {
    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: -direction.x,
      y: 0,
      z: -direction.z
    }));
  }
}
