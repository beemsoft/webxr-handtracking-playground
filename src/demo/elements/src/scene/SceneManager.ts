import { AnimationMixer, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.loadModels();
 }

  private loadModels() {
    let gltfLoader = new GLTFLoader();
    gltfLoader.load('models/element_019_potassium.glb', (gltf) => {
      console.log(gltf);
      gltf.scene.position.x = 0;
      gltf.scene.position.y = 0;
      gltf.scene.position.z = 0;
      gltf.scene.scale.set(5,5,5)
      this.scene.add(gltf.scene);
      this.mixer = new AnimationMixer( gltf.scene );
      this.mixer.clipAction( gltf.animations[0] ).play();
    });
  }

  getInitialCameraAngle(): number {
    return Math.PI/2;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-3, 3, 3);
  }

}
