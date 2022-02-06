import '@tensorflow/tfjs-backend-webgl';
import {VrInitializer} from "../../../shared/webxr/VrInitializer";
import SceneManager from './scene/SceneManager';

let sceneManager = new SceneManager();

async function main() {
  let initializer = new VrInitializer(sceneManager);
  initializer.init();
}

navigator.getUserMedia = navigator.getUserMedia ||
  navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

main();
