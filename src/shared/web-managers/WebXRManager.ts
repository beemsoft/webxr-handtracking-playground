import { Quaternion, Scene, Vector3, WebGLRenderer, WebGLRenderTarget, RawShaderMaterial, PerspectiveCamera, DepthTexture, Mesh, ShaderMaterial } from 'three';
import PhysicsHandler from '../physics/cannon/PhysicsHandler';
import {
  GestureType,
  HandTrackingResult,
  PostProcessingConfig,
  SceneManagerInterface
} from '../scene/SceneManagerInterface';
import CameraManager from '..//webxr/CameraManager';
import {
  XRViewerPose,
  XRFrameOfReference,
  XRReferenceSpace,
  XRRigidTransform,
  XRWebGLLayer,
  XRWebGLBinding,
  XRProjectionLayer
} from '../webxr/WebXRDeviceAPI';
import { EffectComposer } from '../postprocessing/EffectComposer';
import TrackedHandsWithoutPhysicsManager from '../hands/TrackedHandsWithoutPhysicsManager';
import EffectManager from './EffectManager';
import TrackedHandsManager from "../hands/TrackedHandsManager";
import { TextMesh } from '../scene/text/TextMesh';
import { StatsMesh } from '../scene/text/StatsMesh';

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
  private trackedHandsManager: TrackedHandsWithoutPhysicsManager;
  private timestamp = null;
  private composer: EffectComposer;
  private proj_layer: XRProjectionLayer;
  private baseLayer: XRWebGLLayer;
  private xrGLFactory: XRWebGLBinding;
  private xrFramebuffer: WebGLFramebuffer;
  private newRenderTarget: WebGLRenderTarget;
  private fpsText: TextMesh;
  private fpsHandText: TextMesh;
  private statsMesh: StatsMesh;
  private shadowCamera: PerspectiveCamera;
  private fpsTimestamp = 0;
  private fpsFrameCount = 0;
  private currentFps = 0;
  private depthRenderTarget: WebGLRenderTarget;
  private readonly config = {
    enableScreenHud: false,
    enableHandHud: false,
    enableDomOverlay: false,
    enableStats: true,
    enableShadows: true,
    enableDepth: false
  };

  constructor(sceneBuilder: SceneManagerInterface, useDefaultHandGestures: boolean, useAmmoLib: boolean) {
    this.scene.userData.isXR = true;
    this.cameraManager.createVrCamera();
    this.sceneBuilder = sceneBuilder;
    this.useDefaultHandGestures = useDefaultHandGestures;
    if (useAmmoLib) {
      this.trackedHandsManager = new TrackedHandsWithoutPhysicsManager(this.scene, this.cameraManager.cameraVR);
    } else {
      this.trackedHandsManager = new TrackedHandsManager(this.scene, this.physicsHandler, this.cameraManager.cameraVR);
    }

    // @ts-ignore
    navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ["hand-tracking"]
    })
      .then(session => {
        this.session = session;
        let glCanvas: HTMLCanvasElement = document.createElement('canvas');
        this.gl = <WebGLRenderingContext>glCanvas.getContext('webgl2');
        this.gl.makeXRCompatible()
            .then(() => {
          this.renderer = new WebGLRenderer({canvas: glCanvas, context: this.gl, antialias: false, alpha: false});
          this.renderer.shadowMap.enabled = this.config.enableShadows;
          this.renderer.shadowMap.autoUpdate = false;
          this.shadowCamera = new PerspectiveCamera(120, 1, 0.1, 100);
          this.shadowCamera.updateProjectionMatrix();
          this.shadowCamera.matrixAutoUpdate = false;
          this.shadowCamera.frustumCulled = false;

          // Allow shadowMap.enabled to be controlled via config.enableShadows
          const renderer = this.renderer;
          const config = this.config;
          const originalShadowMap = renderer.shadowMap;
          // @ts-ignore
          renderer.shadowMap = new Proxy(originalShadowMap, {
            set: (target, prop, value) => {
              if (prop === 'enabled') {
                config.enableShadows = value;
                target.enabled = value;
                return true;
              }
              // @ts-ignore
              target[prop] = value;
              return true;
            },
            get: (target, prop) => {
              if (prop === 'enabled') return config.enableShadows;
              // @ts-ignore
              const val = target[prop];
              return typeof val === 'function' ? val.bind(target) : val;
            }
          });

          if (this.config.enableScreenHud) {
            this.fpsText = new TextMesh(this.renderer.capabilities.getMaxAnisotropy(), 0.4, 0.2, 2, 60);
            this.fpsText.mesh.position.set(0, 0.2, -0.8); // More central and further away to be visible
            this.fpsText.mesh.frustumCulled = false;
            this.fpsText.mesh.renderOrder = 1000;
            if (this.fpsText.mesh.material instanceof RawShaderMaterial) {
              this.fpsText.mesh.material.depthTest = false;
            }
            // Use a custom property to mark it as HUD to safely ignore it in Pass 1 if needed
            this.fpsText.mesh.userData.isHUD = true;
            this.cameraManager.cameraVR.add(this.fpsText.mesh);
          }

          if (this.config.enableStats) {
            this.statsMesh = new StatsMesh(this.renderer.capabilities.getMaxAnisotropy());
            this.statsMesh.mesh.position.set(0, 0.1, -0.9); // Positioned lower (changed from 0.3)
            this.statsMesh.mesh.scale.set(0.3, 0.3, 0.3); // Scaled to 30%
            this.statsMesh.mesh.frustumCulled = false;
            this.statsMesh.mesh.renderOrder = 1002;
            if (this.statsMesh.mesh.material instanceof RawShaderMaterial) {
              this.statsMesh.mesh.material.depthTest = false;
            }
            this.statsMesh.mesh.userData.isHUD = true;
            this.cameraManager.cameraVR.add(this.statsMesh.mesh);
          }

          if (this.config.enableHandHud) {
            this.fpsHandText = new TextMesh(this.renderer.capabilities.getMaxAnisotropy(), 0.4, 0.2, 2, 60);
            this.fpsHandText.mesh.visible = false;
            this.fpsHandText.mesh.renderOrder = 1001;
            if (this.fpsHandText.mesh.material instanceof RawShaderMaterial) {
              this.fpsHandText.mesh.material.depthTest = false;
            }
            this.scene.add(this.fpsHandText.mesh);
          }

          // @ts-ignore
          this.scene.add(this.cameraManager.cameraVR);

          // Create DOM overlay for HUD
          if (this.config.enableDomOverlay) {
            const overlayElement = document.createElement('div');
            overlayElement.id = 'xr-overlay';
            overlayElement.style.position = 'absolute';
            overlayElement.style.left = '50%';
            overlayElement.style.top = '10%';
            overlayElement.style.transform = 'translateX(-50%)';
            overlayElement.style.color = '#00FF00'; // Bright green
            overlayElement.style.fontFamily = 'sans-serif';
            overlayElement.style.fontSize = '50px'; // Much bigger
            overlayElement.style.fontWeight = 'bold';
            overlayElement.style.padding = '20px';
            overlayElement.style.backgroundColor = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red background for high contrast
            overlayElement.style.border = '5px solid yellow';
            overlayElement.style.pointerEvents = 'none'; // Ensure it doesn't block interactions
            overlayElement.innerText = 'FPS: 0';
            overlayElement.style.display = 'none'; // Hide initially, updateFps will show it
            document.body.appendChild(overlayElement);

            if (!this.composer) {
              // @ts-ignore
              this.baseLayer = new XRWebGLLayer(this.session, this.gl)
              this.session.updateRenderState({
                baseLayer: this.baseLayer,
                // @ts-ignore
                domOverlay: { root: overlayElement }
              });
            }
          } else if (!this.composer) {
            // @ts-ignore
            this.baseLayer = new XRWebGLLayer(this.session, this.gl)
            this.session.updateRenderState({
              baseLayer: this.baseLayer
            });
          }
          this.session.requestReferenceSpace('local')
              .then(space => {
                this.xrReferenceSpace = space;
                this.rotateOrigin(sceneBuilder.getInitialCameraAngle());
                this.setInitialCameraPosition(sceneBuilder.getInitialCameraPosition());

                if (sceneBuilder.isDepthEnabled()) {
                  this.config.enableDepth = true;
                }
                let postProcessingConfig = sceneBuilder.getPostProcessingConfig();
                this.initProjectionLayer(postProcessingConfig);
              }, error => {
                console.log(error.message);
              })
              .then(() => {
                this.sessionActive = true;
                this.session.requestAnimationFrame(this.onXRFrame);
              })
              .then(() => {
                this.renderer.xr.enabled = false;
              })
        })
      })
      .catch(error => {
        console.log(error.message);
      });
  }

  private initProjectionLayer(postProcessingConfig: PostProcessingConfig) {
    if (postProcessingConfig) {
      this.xrFramebuffer = this.gl.createFramebuffer();
      // @ts-ignore
      this.xrGLFactory = new XRWebGLBinding(this.session, this.gl);
      this.proj_layer = this.xrGLFactory.createProjectionLayer({
        space: this.xrReferenceSpace,
        antialias: false,
        colorFormat: (this.gl as any).RGBA8,
        depthFormat: (this.gl as any).DEPTH_COMPONENT24
      });
      // @ts-ignore
      this.session.updateRenderState({
        layers: [this.proj_layer]
      });
      this.renderer.setDrawingBufferSize(this.proj_layer.textureWidth, this.proj_layer.textureHeight, 1);
      this.newRenderTarget = new WebGLRenderTarget(this.proj_layer.textureWidth, this.proj_layer.textureHeight, { samples: 0, depthBuffer: true, stencilBuffer: false });
      this.newRenderTarget.texture.name = 'WebXRManager.newRenderTarget';

      this.composer = new EffectManager().createEffectComposer(
        this.renderer,
        this.cameraManager.cameraVR,
        this.scene,
        this.newRenderTarget,
        this.xrFramebuffer,
        postProcessingConfig
      )
    }

    if (this.config.enableDepth) {
      const width = this.proj_layer ? this.proj_layer.textureWidth : this.baseLayer.framebufferWidth;
      const height = this.proj_layer ? this.proj_layer.textureHeight : this.baseLayer.framebufferHeight;
      this.depthRenderTarget = new WebGLRenderTarget(width, height, {
        depthTexture: new DepthTexture(width, height)
      });
    }
  }

  onXRFrame = (timestamp: DOMHighResTimeStamp, frame: XRFrameOfReference) => {
    this.setDeltaTime(timestamp);
    let session = frame.session;
    session.requestAnimationFrame(this.onXRFrame);
    // if (session.inputSources.length === 0) return;
    let pose = frame.getViewerPose(this.xrReferenceSpace) as XRViewerPose;
    if (!pose) return;

    this.cameraManager.update(pose);
    let index = 0;
    for (let view of pose.views) {
      let viewport = this.getViewPort(view);
      this.cameraManager.updateArrayCamera(index, view, viewport);
      index++;
    }
    if (!this.inputSourcesAvailable) {
      this.sceneBuilder.build(this.cameraManager.cameraVR, this.scene, this.renderer, this.physicsHandler);
      this.inputSourcesAvailable = true;
    }
    this.renderScene(frame, pose);
  };

  private getViewPort(view) {
    if (this.composer) {
      // this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.xrFramebuffer);
      // // @ts-ignore
      // this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, null, 0);
      let glLayer = this.xrGLFactory.getViewSubImage(this.proj_layer, view);
      let viewport = glLayer.viewport;
      // @ts-ignore
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.xrFramebuffer);
      // @ts-ignore
      this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, glLayer.colorTexture, 0);
      // @ts-ignore
      // this.gl.framebufferRenderbuffer(this.gl.FRAMEBUFFER, this.gl.DEPTH_STENCIL_ATTACHMENT, this.gl.RENDERBUFFER, null);

      const fbStatus = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
      if (fbStatus !== this.gl.FRAMEBUFFER_COMPLETE) {
          console.error('Framebuffer incomplete: ' + fbStatus);
      }
      return viewport;
    } else {
      return this.baseLayer.getViewport(view);
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

  private renderScene(frame: XRFrameOfReference, pose: XRViewerPose) {
    let handTrackingResult: HandTrackingResult;
    if (this.trackedHandsManager) {
      handTrackingResult = this.trackedHandsManager.renderHandsAndDetectGesture(frame, pose, this.xrReferenceSpace);
    }
    if (handTrackingResult) {
      if (handTrackingResult.gestureType == GestureType.None) {
        if (this.trackedHandsManager) {
          this.trackedHandsManager.isCameraRotationEnabled = false;
          this.trackedHandsManager.isOriginRotationEnabled = false;
        }
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
    this.physicsHandler.updatePhysics();

    if (this.config.enableHandHud && this.fpsHandText) {
      if (handTrackingResult && handTrackingResult.position) {
        this.displayFps(handTrackingResult.position);
      } else {
        // Keep it at a default position if hands are not tracked
        this.displayFps(new Vector3(0, 0, -1));
      }
    }

    // Pass 1: Preparation (Depth and/or Shadows)
    // We only need a manual Pass 1 if depth is required OR if shadows are enabled without a composer
    const needsManualPass1 = this.config.enableDepth || (this.config.enableShadows && !this.composer);

    if (needsManualPass1) {
      if (this.config.enableDepth && this.depthRenderTarget) {
        this.renderer.setRenderTarget(this.depthRenderTarget);
      } else {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      }
      this.renderer.clear();

      if (this.config.enableShadows) {
        this.renderer.shadowMap.needsUpdate = true;
        if (this.config.enableScreenHud && this.fpsText) this.fpsText.mesh.visible = false;
        if (this.config.enableHandHud && this.fpsHandText) this.fpsHandText.mesh.visible = false;
        if (this.config.enableStats && this.statsMesh) this.statsMesh.mesh.visible = false;
      }

      // Sync shadowCamera with head pose for consistent depth and shadow map updates
      this.shadowCamera.position.copy(this.cameraManager.cameraVR.position);
      this.shadowCamera.quaternion.copy(this.cameraManager.cameraVR.quaternion);
      this.shadowCamera.updateMatrixWorld(true);
      this.shadowCamera.matrixWorldInverse.copy(this.shadowCamera.matrixWorld).invert();
      this.shadowCamera.updateProjectionMatrix();

      // Hide ocean or any transparent objects that shouldn't contribute to depth for foam
      this.scene.traverse((obj) => {
        if (obj.name === 'OceanSurf' || (obj as any).material?.transparent) {
          obj.userData.oldVisible = obj.visible;
          obj.visible = false;
        }
      });

      this.renderer.render(this.scene, this.shadowCamera);

      // Restore visibility
      this.scene.traverse((obj) => {
        if (obj.userData.oldVisible !== undefined) {
          obj.visible = obj.userData.oldVisible;
          delete obj.userData.oldVisible;
        }
      });

      this.renderer.setRenderTarget(null);

      if (this.config.enableShadows) {
        if (this.config.enableScreenHud && this.fpsText) this.fpsText.mesh.visible = true;
        if (this.config.enableHandHud && this.fpsHandText) this.fpsHandText.mesh.visible = true;
        if (this.config.enableStats && this.statsMesh) this.statsMesh.mesh.visible = true;
      }

      // Pass depth texture and matrices to the ocean material
      if (this.config.enableDepth && this.depthRenderTarget) {
        this.scene.traverse((obj) => {
          if (obj.name === 'OceanSurf' && (obj as Mesh).material instanceof ShaderMaterial) {
            const mat = (obj as Mesh).material as ShaderMaterial;
            mat.uniforms.uDepthTexture.value = this.depthRenderTarget.depthTexture;
            mat.uniforms.uCameraNear.value = this.shadowCamera.near;
            mat.uniforms.uCameraFar.value = this.shadowCamera.far;
            mat.uniforms.uProjMatrix.value.copy(this.shadowCamera.projectionMatrix);
            mat.uniforms.uViewMatrix.value.copy(this.shadowCamera.matrixWorldInverse);
          }
        });
      }
    }

    // Pass 2: Final Render
    if (!this.config.enableShadows) {
      this.renderer.shadowMap.enabled = false;
    }

    if (this.composer) {
      if (this.config.enableShadows && !needsManualPass1) {
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.renderer.setRenderTarget(null);
      this.updateFps();
      this.composer.render();
    } else {
      this.updateFps();
      let layer = frame.session.renderState.baseLayer;
      if (layer) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, layer.framebuffer);
      }
      this.cameraManager.cameraVR.updateMatrixWorld(true);
      this.renderer.render(this.scene, this.cameraManager.cameraVR);
    }
    this.sceneBuilder.postUpdate();
  }

  private displayFps(position: Vector3) {
    if (this.fpsHandText) {
      this.fpsHandText.mesh.position.set(position.x, position.y + 0.1, position.z);
      if (this.cameraManager.cameraVR.position) {
        // Use the same lookAt logic as SceneManager
        this.fpsHandText.mesh.lookAt(this.cameraManager.cameraVR.position);
      }
    }
  }

  private updateFps() {
    this.fpsFrameCount++;
    const now = performance.now();
    if (now >= this.fpsTimestamp + 1000) {
      this.currentFps = Math.round((this.fpsFrameCount * 1000) / (now - this.fpsTimestamp));
      this.fpsTimestamp = now;
      this.fpsFrameCount = 0;
      const overlay = document.getElementById('xr-overlay');
      if (overlay && this.config.enableDomOverlay) {
        overlay.innerText = "FPS: " + this.currentFps;
        overlay.style.display = 'block';
      }
      if (this.fpsText && this.config.enableScreenHud) {
        this.fpsText.set("FPS: " + this.currentFps);
      }
      if (this.fpsHandText && this.config.enableHandHud) {
        // Only call .set() when the value actually changed to reduce texSubImage2D calls
        this.fpsHandText.set("FPS: " + this.currentFps);
      }
      if (this.statsMesh && this.config.enableStats) {
        this.statsMesh.update(this.currentFps);
      }
    }
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
