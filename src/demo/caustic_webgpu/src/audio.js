import { MathUtils } from "../vendor/three/build/three.webgpu.js";
import AudioHandler, { AudioDemo } from "../../../shared/audio/AudioHandler";

/**
 * Underwater hum while the viewer is below the surface, the ocean loop above it (as in the other ocean
 * demos). Both loops share one audio context and crossfade by head height.
 */
export function createUnderwaterAudio(waterHeight) {
  const surface = new AudioHandler();
  const underwater = new AudioHandler();
  let started = false;
  let mix = 1;
  surface.initAudio(AudioDemo.ocean);
  underwater.initAudio(AudioDemo.underwater, undefined, surface.getAudioContext());
  surface.audioElement.loop = true;
  underwater.audioElement.loop = true;
  surface.setGain(0);
  underwater.setGain(1);

  function playAll() {
    return Promise.all([surface.audioElement.play(), underwater.audioElement.play()]);
  }
  function start() {
    if (started) return;
    surface.resume();
    underwater.resume();
    playAll()
      .then(() => {
        started = true;
      })
      .catch(() => {});
  }
  // Autoplay is blocked until the first user gesture.
  const events = ["click", "touchstart", "keydown"];
  const gesture = () => {
    start();
    if (started) for (const name of events) window.removeEventListener(name, gesture);
  };
  for (const name of events) window.addEventListener(name, gesture);
  start();

  return {
    start,
    update(delta, headHeight) {
      if (!started) return;
      mix = MathUtils.damp(mix, headHeight < waterHeight ? 1 : 0, 6, delta);
      surface.setGain(Math.pow(1 - mix, 1.8));
      underwater.setGain(Math.pow(mix, 1.4));
    },
    dispose() {
      for (const name of events) window.removeEventListener(name, gesture);
      surface.audioElement.pause();
      underwater.audioElement.pause();
    },
  };
}
