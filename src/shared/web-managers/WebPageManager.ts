import {PerspectiveCamera, Scene, Timer, WebGLRenderer} from 'three';
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
    this.renderer.autoClear = false;

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
  }
}

