import { Water } from '../scene/water/Water2';
import {Clock, PerspectiveCamera, Scene, WebGLRenderer} from 'three/src/Three';

export default class Water2Manager {

  private clock = new Clock();


  updateFlow(water: Water) {

    const delta = this.clock.getDelta();
    // @ts-ignore
    const config = water.material.uniforms[ 'config' ];

    config.value.x += water.flowSpeed * delta; // flowMapOffset0
    config.value.y = config.value.x + water.halfCycle; // flowMapOffset1

    // Important: The distance between offsets should be always the value of "halfCycle".
    // Moreover, both offsets should be in the range of [ 0, cycle ].
    // This approach ensures a smooth water flow and avoids "reset" effects.

    if ( config.value.x >= water.cycle ) {

      config.value.x = 0;
      config.value.y = water.halfCycle;

    } else if ( config.value.y >= water.cycle ) {

      config.value.y = config.value.y - water.cycle;

    }

  }

  updateTextureMatrix( water: Water, camera: PerspectiveCamera) {

    water.textureMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );

    water.textureMatrix.multiply( camera.projectionMatrix );
    water.textureMatrix.multiply( camera.matrixWorldInverse );
    water.textureMatrix.multiply( water.matrixWorld );

  }

  update(water: Water, renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.updateTextureMatrix( water, camera );
    this.updateFlow(water);

    water.visible = false;

    water.reflector.matrixWorld.copy( water.matrixWorld );
    water.refractor.matrixWorld.copy( water.matrixWorld );


    water.reflector.render( renderer, scene, camera );
    water.refractor.onBeforeRender2( renderer, scene, camera );

    water.visible = true;

    renderer.setRenderTarget(null);
  }
}
