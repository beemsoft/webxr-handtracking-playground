import {VrInitializer} from "./webxr/VrInitializer";
import WebPageManager from "./web-managers/WebPageManager";
import {setupOldMediaPipeStuff} from "./NonVrInitializer";

function nonVrSetup(sceneManager, useMediaPipeStuff) {
    if (useMediaPipeStuff) setupOldMediaPipeStuff(sceneManager);
    new WebPageManager(sceneManager);
}

export function determineVrOrNonVrSetup(sceneManager, useMediaPipeStuff, useDefaultHandGestures) {
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr')
            .then(isSupported => {
                if (isSupported) {
                    new VrInitializer(sceneManager, useDefaultHandGestures);
                } else {
                    nonVrSetup(sceneManager, useMediaPipeStuff);
                }
            });
    } else {
        nonVrSetup(sceneManager, useMediaPipeStuff);
    }
}
