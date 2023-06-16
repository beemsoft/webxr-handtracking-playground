import { Quaternion, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three/src/Three';
import PhysicsHandler from '../physics/PhysicsHandler';
import {
  GestureType,
  HandTrackingResult,
  PostProcessingConfig,
  SceneManagerInterface
} from '../scene/SceneManagerInterface';
import CameraManager from '..//webxr/CameraManager';
import {
  XRDevicePose,
  XRFrameOfReference,
  XRReferenceSpace,
  XRRigidTransform,
  XRWebGLLayer,
  XRWebGLBinding,
  XRProjectionLayer
} from '../webxr/WebXRDeviceAPI';
import { EffectComposer } from '../postprocessing/EffectComposer';
import TrackedHandsManager from '../hands/TrackedHandsManager';
import EffectManager from './EffectManager';

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
  private useDefaultHandGestures: boolean;
  private cameraManager = new CameraManager();
  private trackedHandsManager = new TrackedHandsManager(this.scene, this.physicsHandler, this.cameraManager.cameraVR);
  private timestamp = null;
  private composer: EffectComposer;
  private proj_layer: XRProjectionLayer;
  private baseLayer: XRWebGLLayer;
  private xrGLFactory: XRWebGLBinding;
  private xrFramebuffer: WebGLFramebuffer;
  private newRenderTarget: WebGLRenderTarget;

  constructor(sceneBuilder: SceneManagerInterface, useDefaultHandGestures: boolean) {
    this.cameraManager.createVrCamera();
    this.sceneBuilder = sceneBuilder;
    this.useDefaultHandGestures = useDefaultHandGestures;

    navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ["hand-tracking"]
    })
      .then(session => {
        this.session = session;
        this.initRenderer();
        this.session.requestReferenceSpace('local')
          .then(space => {
            this.xrReferenceSpace = space;
            this.rotateOrigin(sceneBuilder.getInitialCameraAngle());
            this.setInitialCameraPosition(sceneBuilder.getInitialCameraPosition());

            let postProcessingConfig = sceneBuilder.getPostProcessingConfig();
            if (postProcessingConfig) {
              this.initProjectionLayer(postProcessingConfig);
            }
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

  private initProjectionLayer(postProcessingConfig: PostProcessingConfig) {
    this.xrFramebuffer = this.gl.createFramebuffer();
    // @ts-ignore
    this.xrGLFactory = new XRWebGLBinding(this.session, this.gl);
    this.proj_layer = this.xrGLFactory.createProjectionLayer({space: this.xrReferenceSpace});
    this.session.updateRenderState({layers: [this.proj_layer]});
    this.renderer.setDrawingBufferSize(this.proj_layer.textureWidth, this.proj_layer.textureHeight, 1);
    this.newRenderTarget = new WebGLRenderTarget(this.proj_layer.textureWidth, this.proj_layer.textureHeight);

    if (postProcessingConfig) {
      this.composer = new EffectManager().createEffectComposer(
        this.renderer,
        this.cameraManager.cameraVR,
        this.scene,
        this.newRenderTarget,
        this.xrFramebuffer,
        postProcessingConfig
      )
    }
  }

  private initRenderer() {
    let glCanvas: HTMLCanvasElement = document.createElement('canvas');
    this.gl = <WebGLRenderingContext>glCanvas.getContext('webgl2', {xrCompatible: true});
    this.renderer = new WebGLRenderer({canvas: glCanvas, context: this.gl, alpha: false});
    if (!this.composer) {
      // @ts-ignore
      this.baseLayer = new XRWebGLLayer(this.session, this.gl)
      this.session.updateRenderState({baseLayer: this.baseLayer});
    }
  }

  onXRFrame = (timestamp: DOMHighResTimeStamp, frame: XRFrameOfReference) => {
    this.setDeltaTime(timestamp);
    let session = frame.session;
    session.requestAnimationFrame(this.onXRFrame);
    if (session.inputSources.length === 0) return;
    let pose = frame.getViewerPose(this.xrReferenceSpace);
    if (!pose) return;
    if (!this.composer) {
      let layer = session.renderState.baseLayer;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, layer.framebuffer);
    }
    let index = 0;
    for (let view of pose.views) {
      let viewport = this.getViewPort(view);
      this.cameraManager.updateArrayCamera(index, view, viewport);
      index++;
    }
    if (!this.inputSourcesAvailable) {
      if (this.session.inputSources.length > 0) {
        this.sceneBuilder.build(this.cameraManager.cameraVR, this.scene, this.renderer, this.physicsHandler);
        this.inputSourcesAvailable = true;
      }
    } else {
      this.renderScene(frame, pose);
    }
  };

  private getViewPort(view) {
    if (this.composer) {
      let glLayer = this.xrGLFactory.getViewSubImage(this.proj_layer, view);
      let viewport = glLayer.viewport;
      this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, glLayer.colorTexture, 0);
      return viewport;
    } else {
      let viewport = this.baseLayer.getViewport(view);
      this.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      return viewport;
    }
  }

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
    let handTrackingResult: HandTrackingResult = this.trackedHandsManager.renderHandsAndDetectGesture(frame, pose, this.xrReferenceSpace);
    if (handTrackingResult) {
      if (handTrackingResult.gestureType == GestureType.None) {
        this.trackedHandsManager.isCameraRotationEnabled = false;
        this.trackedHandsManager.isOriginRotationEnabled = false;
      } else {
        if (this.useDefaultHandGestures) {
          if (handTrackingResult.gestureType == GestureType.Index_Thumb) {
            let direction = new Vector3(handTrackingResult.position.x - this.cameraManager.cameraVR.position.x, handTrackingResult.position.y - this.cameraManager.cameraVR.position.y, handTrackingResult.position.z - this.cameraManager.cameraVR.position.z).multiplyScalar(0.1)
            this.moveInDirection(direction);
          } else if (handTrackingResult.gestureType == GestureType.Ring_Thumb) {
            if (!this.trackedHandsManager.isPinchingEnabled) {
              if (!this.trackedHandsManager.isCameraRotationEnabled) {
                let vector1 = new Vector3(this.cameraManager.cameraVR.position.x, this.cameraManager.cameraVR.position.y, this.cameraManager.cameraVR.position.z);
                this.trackedHandsManager.rotationStartPos = new Vector3(this.cameraManager.cameraVR.position.x, 0, this.cameraManager.cameraVR.position.z);
                this.trackedHandsManager.rotationStartVector = vector1.sub(this.trackedHandsManager.rotationStartPos);
                this.trackedHandsManager.rotationPosition = new Vector3(this.cameraManager.cameraVR.position.x, 0, this.cameraManager.cameraVR.position.z)
              } else {
                this.trackedHandsManager.offsetAngle = Math.PI / 140;
              }
              this.trackedHandsManager.isCameraRotationEnabled = true;
              if (this.trackedHandsManager.isCameraRotationEnabled) {
                this.rotateView(this.trackedHandsManager.offsetAngle, this.trackedHandsManager.rotationPosition);
              }
            }
          } else if (handTrackingResult.gestureType == GestureType.Pinky_Thumb) {
            if (this.trackedHandsManager.isOriginRotationEnabled) {
              this.trackedHandsManager.offsetAngle = Math.PI / 140;
            }
            this.trackedHandsManager.isOriginRotationEnabled = true;
            if (this.trackedHandsManager.isOriginRotationEnabled) {
              this.rotateOrigin(this.trackedHandsManager.offsetAngle);
            }
          } else if (handTrackingResult.gestureType == GestureType.Middle_Thumb) {
            if (this.trackedHandsManager.isPinchingEnabled) {
              this.trackedHandsManager.material.color.set(0xdd00cc);
              this.trackedHandsManager.isPinchingEnabled = false;
            } else {
              this.trackedHandsManager.material.color.set(0xFF3333);
              this.trackedHandsManager.isPinchingEnabled = true;
            }
          }
        } else {
          this.sceneBuilder.handleGesture(handTrackingResult);
        }
      }
    }
    this.sceneBuilder.update();
    this.cameraManager.update(pose);
    this.physicsHandler.updatePhysics();
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.cameraManager.cameraVR);
    }
    this.sceneBuilder.postUpdate();
  }

  private setInitialCameraPosition(direction: Vector3) {
    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: -direction.x,
      y: -direction.y,
      z: -direction.z
    }));
  }

  private moveInDirection(direction: Vector3) {
    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: -direction.x,
      y: -direction.y,
      z: -direction.z
    }));
  }

  private rotateOrigin(rotationAngle: number) {
    let quat = new Quaternion().identity();
    let inverseOrientation;
    quat.identity()
    inverseOrientation = quat.setFromAxisAngle(new Vector3(0, 1, 0), rotationAngle);
    let position =  new Vector3();

    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform(position, {
      x: -inverseOrientation.x,
      y: -inverseOrientation.y,
      z: -inverseOrientation.z,
      w: -inverseOrientation.w
    }));
  }

  private rotateView(rotationAngle: number, rotationStartVector: Vector3) {
    let quat = new Quaternion().identity();
    let inverseOrientation;
    quat.identity()
    inverseOrientation = quat.setFromAxisAngle(new Vector3(0, 1, 0), -rotationAngle);

    let position =  new Vector3();

    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: rotationStartVector.x,
      y: 0,
      z: rotationStartVector.z
    }));
    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform(position, {
      x: -inverseOrientation.x,
      y: -inverseOrientation.y,
      z: -inverseOrientation.z,
      w: -inverseOrientation.w
    }));
    // @ts-ignore
    this.xrReferenceSpace = this.xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({
      x: -rotationStartVector.x,
      y: 0,
      z: -rotationStartVector.z
    }));
  }
}
