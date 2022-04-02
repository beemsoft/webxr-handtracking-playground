import {VrInitializer} from "./webxr/VrInitializer";
import {Vector3} from "three";
import WebPageManager from "./web-managers/WebPageManager";
import {setupOldMediaPipeStuff} from "./NonVrInitializer";

const cameraPosition = new Vector3(-0.5, 1.75, 4);

function nonVrSetup(sceneManager, cameraPosition, useMediaPipeStuff) {
    if (useMediaPipeStuff) setupOldMediaPipeStuff(sceneManager);
    new WebPageManager(sceneManager, cameraPosition);
}

export function determineVrOrNonVrSetup(sceneManager, useMediaPipeStuff) {
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr')
            .then(isSupported => {
                if (isSupported) {
                    new VrInitializer(sceneManager);
                } else {
                    nonVrSetup(sceneManager, cameraPosition, useMediaPipeStuff);
                }
            });
    } else {
        nonVrSetup(sceneManager, cameraPosition, useMediaPipeStuff);
    }
}
