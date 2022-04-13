import { AnimationMixer, Clock, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { SceneHelper } from '../../../../shared/scene/SceneHelper';
import HandPoseManager from '../../../../shared/hands/HandPoseManager';
import { GestureType, SceneManagerInterface } from '../../../../shared/scene/SceneManagerInterface';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

export default class SceneManager implements SceneManagerInterface {
  private scene: Scene;
  private sceneHelper: SceneHelper;
  private physicsHandler: PhysicsHandler;
  private handPoseManager: HandPoseManager;
  private clock = new Clock();
  private mixer: AnimationMixer;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.physicsHandler = physicsHandler;
    this.sceneHelper.addLight(true);
    this.loadModels();
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
 }

  private loadModels() {
    let gltfLoader = new GLTFLoader();
    gltfLoader.load('models/element_019_potassium.glb', (gltf) => {
      console.log(gltf);
      gltf.scene.position.x = 0;
      gltf.scene.position.y = 0;
      gltf.scene.position.z = 0;
      gltf.scene.scale.set(5,5,5)
      // gltf.scene.rotation.y = 360
      this.scene.add(gltf.scene);
      this.mixer = new AnimationMixer( gltf.scene );
      this.mixer.clipAction( gltf.animations[0] ).play();
    });
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixer) {
        this.mixer.update(delta);
      }
  }

  updateHandPose(result) {
  }

  handleGesture(gesture: GestureType) {
  }

  getInitialCameraAngle(): number {
    return Math.PI/2;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-3, 3, 3);
  }

}
