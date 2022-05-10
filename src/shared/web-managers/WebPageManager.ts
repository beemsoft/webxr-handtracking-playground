import { Clock, PerspectiveCamera, Scene, WebGLRenderer } from 'three/src/Three';
import { SceneManagerInterface } from '../scene/SceneManagerInterface';
import PhysicsHandler from '../physics/PhysicsHandler';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default class WebPageManager {
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene = new Scene();
  private sceneBuilder: SceneManagerInterface;
  private readonly physicsHandler: PhysicsHandler;
  private controls: OrbitControls;
  private clock = new Clock();

  constructor(sceneManager: SceneManagerInterface) {
    this.sceneBuilder = sceneManager;
    this.physicsHandler = new PhysicsHandler();
    this.camera = new PerspectiveCamera();
    let cameraPosition = sceneManager.getInitialCameraPosition();
    if (cameraPosition) {
      this.camera.position.add(cameraPosition);
    }
    this.renderer = new WebGLRenderer({alpha: false});
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    this.sceneBuilder.build(this.camera, this.scene, this.renderer, this.physicsHandler);
    this.addTrackBallControls();
    this.addOutputToPage();
    window.addEventListener( 'resize', this.onWindowResize, false );
    this.clock.start();
    this.render();
  }

  private render = () => {
    this.physicsHandler.dt = 1 / (1 / this.clock.getDelta());
    this.renderer.setAnimationLoop(this.render);
    this.sceneBuilder.update();
    this.controls.update();
    this.physicsHandler.updatePhysics();
    this.renderer.render(this.scene, this.camera);
    this.sceneBuilder.postUpdate();
  };

  private addTrackBallControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
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

