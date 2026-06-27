import {PerspectiveCamera, Scene, Timer, WebGLRenderer, WebGLRenderTarget, DepthTexture, Mesh, ShaderMaterial} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { SceneManagerInterface } from '../scene/SceneManagerInterface';
import PhysicsHandler from '../physics/cannon/PhysicsHandler';
import { EffectComposer } from '../postprocessing/EffectComposer';
import EffectManager from './EffectManager';
import Stats from 'three/examples/jsm/libs/stats.module';

export default class WebPageManager {
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene = new Scene();
  private sceneBuilder: SceneManagerInterface;
  private readonly physicsHandler: PhysicsHandler;
  private controls: OrbitControls;
  private timer = new Timer();
  private composer: EffectComposer;
  private finalRenderTarget = null;
  private depthRenderTarget: WebGLRenderTarget;
  private stats: Stats;

  constructor(sceneManager: SceneManagerInterface) {
    this.sceneBuilder = sceneManager;
    this.physicsHandler = new PhysicsHandler();
    this.camera = new PerspectiveCamera();
    let cameraPosition = sceneManager.getInitialCameraPosition();
    if (cameraPosition) {
      this.camera.position.add(cameraPosition);
    }
    this.renderer = new WebGLRenderer({alpha: false, antialias: false});
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    if (sceneManager.isDepthEnabled()) {
      this.depthRenderTarget = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        depthTexture: new DepthTexture(window.innerWidth, window.innerHeight)
      });
    }

    let postProcessingConfig = sceneManager.getPostProcessingConfig();
    if (postProcessingConfig) {
      this.composer = new EffectManager().createEffectComposer(
        this.renderer,
        this.camera,
        this.scene,
        this.finalRenderTarget,
        undefined,
        postProcessingConfig
      )
    }

    this.sceneBuilder.build(this.camera, this.scene, this.renderer, this.physicsHandler);
    this.addTrackBallControls();
    this.addStats();
    this.addOutputToPage();
    window.addEventListener( 'resize', this.onWindowResize, false );
    this.timer.reset();
    this.render();
  }

  private render = () => {
    this.stats.begin();
    this.timer.update();
    this.physicsHandler.dt = 1 / (1 / this.timer.getDelta());
    this.renderer.setAnimationLoop(this.render);
    this.sceneBuilder.update();
    this.physicsHandler.updatePhysics();

    if (this.depthRenderTarget) {
      this.renderer.setRenderTarget(this.depthRenderTarget);
      this.renderer.clear();
      this.scene.traverse((obj) => {
        if (obj.name === 'OceanSurf' || (obj as any).material?.transparent) {
          obj.userData.oldVisible = obj.visible;
          obj.visible = false;
        }
      });
      this.renderer.render(this.scene, this.camera);
      this.scene.traverse((obj) => {
        if (obj.userData.oldVisible !== undefined) {
          obj.visible = obj.userData.oldVisible;
          delete obj.userData.oldVisible;
        }
      });
      this.renderer.setRenderTarget(null);

      this.scene.traverse((obj) => {
        if (obj.name === 'OceanSurf' && (obj as Mesh).material instanceof ShaderMaterial) {
          const mat = (obj as Mesh).material as ShaderMaterial;
          mat.uniforms.uDepthTexture.value = this.depthRenderTarget.depthTexture;
          mat.uniforms.uCameraNear.value = this.camera.near;
          mat.uniforms.uCameraFar.value = this.camera.far;
          mat.uniforms.uProjMatrix.value.copy(this.camera.projectionMatrix);
          mat.uniforms.uViewMatrix.value.copy(this.camera.matrixWorldInverse);
        }
      });
    }

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.sceneBuilder.postUpdate();
    this.stats.end();
  };

  private addTrackBallControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    let target = this.sceneBuilder.getInitialCameraTarget();
    if (target) {
      this.controls.target.copy(this.sceneBuilder.getInitialCameraTarget());
      this.controls.update();
    }
  }

  private addStats() {
    this.stats = new Stats();
    document.body.appendChild(this.stats.dom);
  }

  private addOutputToPage = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.appendChild(this.renderer.domElement);
  };

  private onWindowResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize( window.innerWidth, window.innerHeight );
    if (this.depthRenderTarget) {
      this.depthRenderTarget.setSize(window.innerWidth, window.innerHeight);
    }
  }
}

