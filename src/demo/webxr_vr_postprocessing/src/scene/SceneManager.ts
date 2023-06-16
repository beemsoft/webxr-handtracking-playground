import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  ReinhardToneMapping,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { PostProcessingConfig, PostProcessingType } from '../../../../shared/scene/SceneManagerInterface';

export default class SceneManager extends SceneManagerParent {

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    const triangle = new BufferGeometry();
    triangle.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 1, 1, -1, 1, 0, 1, 1], 3)
    );

    const orange = new Mesh(
      triangle,
      new MeshBasicMaterial({color: 'orange', side: DoubleSide})
    );
    orange.position.x = -3;
    scene.add(orange);

    const red = new Mesh(
      triangle,
      new MeshBasicMaterial({color: 0xff2060, side: DoubleSide})
    );
    scene.add(red);

    const blue = new Mesh(
      triangle,
      new MeshBasicMaterial({color: 'cyan', side: DoubleSide})
    );
    blue.position.x = 3;
    scene.add(blue);
  };

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

  getInitialCameraPosition() {
    return new Vector3(0, 0, -8);
  }

}
