import { AmbientLight, AnimationMixer, PerspectiveCamera, ReinhardToneMapping, Scene, Vector3, WebGLRenderer, } from 'three/src/Three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { PostProcessingConfig, PostProcessingType } from '../../../../shared/scene/SceneManagerInterface';

export default class SceneManager extends SceneManagerParent {

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.scene.add(new AmbientLight(0x898989));
    new GLTFLoader().load('./models/gltf/PrimaryIonDrive.glb', (gltf) => {
      const model = gltf.scene;
      scene.add(model);
      this.mixer = new AnimationMixer(model);
      this.mixer.clipAction(gltf.animations[0].optimize()).play();
    });
  };

  getInitialCameraPosition() {
    return new Vector3(-5, 2.5, -3.5);
    // return new Vector3(0,0,0);
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return {
      postProcessingType: PostProcessingType.Bloom,
      toneMapping: ReinhardToneMapping,
      threshold: 0,
      strength: 1.5,
      radius: 0,
      exposure: 1
    };
  }

}
