import {VrInitializer} from "./webxr/VrInitializer";
import WebPageManager from "./web-managers/WebPageManager";
import {setupOldMediaPipeStuff} from "./NonVrInitializer";

function nonVrSetup(sceneManager, useMediaPipeStuff) {
    if (useMediaPipeStuff) setupOldMediaPipeStuff(sceneManager);
    new WebPageManager(sceneManager);
}

/**
 * Checks if the user agent matches a Meta Quest, Pico, Vive, Wolvic, Vision, or similar VR device / browser.
 */
function isVrDeviceUserAgent() {
    const ua = navigator.userAgent;
    return /OculusBrowser|Quest|Pico|Wolvic|Vive|Vision|Mobile VR|XR/i.test(ua);
}

export function determineVrOrNonVrSetup(sceneManager, useMediaPipeStuff, useDefaultHandGestures, useAmmoLib) {
    // 1. First fast-fail if it's not a VR device's native browser
    if (!isVrDeviceUserAgent()) {
        nonVrSetup(sceneManager, useMediaPipeStuff);
        return;
    }

    // 2. Then check if WebXR immersive-vr is supported
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr')
            .then(isSupported => {
                if (isSupported) {
                    new VrInitializer(sceneManager, useDefaultHandGestures, useAmmoLib);
                } else {
                    nonVrSetup(sceneManager, useMediaPipeStuff);
                }
            })
            .catch(() => {
                nonVrSetup(sceneManager, useMediaPipeStuff);
            });
    } else {
        nonVrSetup(sceneManager, useMediaPipeStuff);
    }
}
