import {DirectionalLight, HemisphereLight, Scene} from 'three';
import {TextMesh} from './text/TextMesh';

export class SceneHelper {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  addLight(useHemisphere: boolean) {
    let light = new DirectionalLight(0xFFFFFF, 0.8);
    light.position.set(2, 4, 2);
    light.castShadow = false;
    this.scene.add(light);
    if (useHemisphere) this.scene.add(new HemisphereLight(0x909090, 0x404040, 0.3));
  }

  addMessage(message: string, maxAnisotropy: number) {
    let text = new TextMesh(maxAnisotropy, 1024, 512, 4, 50);
    this.scene.add(text.mesh);
    text.mesh.position.set(0, 1, -2);
    text.set(message);
  }
}
