import {
  AmbientLight,
  BackSide,
  DirectionalLight,
  FrontSide,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

import {Pool} from "./Pool";
import {WaterSimulation} from "./WaterSimulation";
import {Water} from "./Water";
import {loadFile} from "../utils/utils";
import {Caustics} from "./Caustics";
import {GestureType, HandTrackingResult} from "../../../../shared/scene/SceneManagerInterface";

export default class SceneManager extends SceneManagerParent {
  private waterSimulation = new WaterSimulation();
  private water: Mesh;
  private caustics: Caustics;
  private pool: Mesh;
  private waterTexture: any;
  private causticsTexture: any;
  private latestGesture = GestureType.None;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
    super.build(camera, scene, renderer, physicsHandler);

    loadFile('shaders/utils.glsl').then((utils) => {
      ShaderChunk['utils'] = utils;
      this.pool = new Pool();
      this.scene.add(this.pool);
      this.water = new Water();
      this.scene.add(this.water);
      this.caustics = new Caustics(this.water.geometry);

      for (var i = 0; i < 20; i++) {
        this.waterSimulation.addDrop(
            renderer,
            Math.random() * 2 - 1, Math.random() * 2 - 1,
            0.03, (i & 1) ? 0.02 : -0.02
        );
      }
    });

    // light
    const ambientLight = new  AmbientLight( 0xe7e7e7, 1.2 );
    scene.add( ambientLight );

    const directionalLight = new DirectionalLight( 0xffffff, 2 );
    directionalLight.position.set( - 1, 1, 1 );
    scene.add( directionalLight );

    const loaded = [this.waterSimulation.loaded];

    Promise.all(loaded).then(() => {

      for (var i = 0; i < 20; i++) {
        this.waterSimulation.addDrop(
            renderer,
            Math.random() * 2 - 1, Math.random() * 2 - 1,
            0.03, (i & 1) ? 0.02 : -0.02
        );
      }

    });
  };

  update() {
    if (this.water && this.waterSimulation.loaded && this.waterSimulation._dropMesh && this.waterSimulation._normalMesh && this.waterSimulation._updateMesh) {
      // console.log('update water');
      // @ts-ignore
      this.water.material.uniforms['water'].value = this.waterTexture;
      // @ts-ignore
      this.water.material.uniforms['causticTex'].value = this.causticsTexture;

      // @ts-ignore
      this.water.material.side = FrontSide;
      // @ts-ignore
      this.water.material.uniforms['underwater'].value = true;
      this.renderer.render(this.water, this.camera);
      // @ts-ignore
      this.water.material.side = BackSide;
      // @ts-ignore
      this.water.material.uniforms['underwater'].value = false;
    }
  }

  getInitialCameraPosition() {
    return new Vector3(0, 0, 0);
    // return new Vector3(-3, 2, 1);
  }

  postUpdate() {
    if (this.waterSimulation.loaded && this.waterSimulation._dropMesh && this.waterSimulation._normalMesh && this.waterSimulation._updateMesh && this.caustics && this.caustics.loaded) {
      this.waterSimulation.stepSimulation(this.renderer);
      this.waterSimulation.updateNormals(this.renderer);
      this.waterTexture = this.waterSimulation.texture.texture;
      this.caustics.update(this.renderer, this.waterTexture);
      this.causticsTexture = this.caustics.texture.texture;
      if (this.pool) {
        // @ts-ignore
        this.pool.material.uniforms['water'].value = this.waterTexture;
        // @ts-ignore
        this.pool.material.uniforms['causticTex'].value = this.causticsTexture;
      }
      this.renderer.setRenderTarget(null);
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType != GestureType.None && gesture.gestureType != this.latestGesture) {
      // this.latestGesture = gesture.gestureType;
      if (gesture.gestureType == GestureType.Open_Hand) {
        this.waterSimulation.addDrop(this.renderer, gesture.position.x, gesture.position.z, 0.03, 0.04);
      }
    }
  }

}
