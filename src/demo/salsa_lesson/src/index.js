import '@tensorflow/tfjs-backend-webgl';
import {VrInitializer} from "../../../shared/webxr/VrInitializer";
import SceneManager from './scene/SceneManager';
import {Vector3} from "three";

let sceneManager = new SceneManager();

async function main() {
  let initializer = new VrInitializer(sceneManager);
  let cameraPosition = new Vector3(-0.5, 1.75, 4);
  initializer.init(cameraPosition);
}

navigator.getUserMedia = navigator.getUserMedia ||
  navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

main();
