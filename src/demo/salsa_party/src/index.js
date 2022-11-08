import SceneManager from './scene/SceneManager';
import {determineVrOrNonVrSetup} from "../../../shared/DetermineVrOrNonVrSetup";

let sceneManager = new SceneManager();

// if (window.Worker) {
//     console.log('Werker!')
// }
// const myWorker = new Worker('worker.js');
//
// myWorker.postMessage(["hello"]);
// console.log('Message posted to worker');
//
//
// myWorker.postMessage(["world"]);
// console.log('Message posted to worker');
//
// myWorker.onmessage = (e) => {
//     console.log('Message received from worker: ' + e.data);
// }

determineVrOrNonVrSetup(sceneManager, false);
