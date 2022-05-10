import {DirectionalLight, HemisphereLight, Scene} from 'three/src/Three';
import {TextMesh} from './text/TextMesh';

export class SceneHelper {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  addLight(useHemisphere: boolean) {
    let light = new DirectionalLight(0xFFFFFF, 1);
    light.position.set(130, 450, -450);
    this.scene.add(light);
    if (useHemisphere) this.scene.add(new HemisphereLight(0x909090, 0x404040));
  }

  addMessage(message: string, maxAnisotropy: number) {
    let text = new TextMesh(maxAnisotropy, 1024, 512);
    this.scene.add(text.mesh);
    text.mesh.position.set(0, 1, -2);
    text.set(message);
  }
}
