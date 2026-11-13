# Caustic (WebGPU)

mrdoob's Codevember 2026 #10 ("Caustic", <https://mrdoob.github.io/codevember-2026/10/>) running on its **original
WebGPU / TSL pipeline**, inside this project, with an immersive WebXR path for Meta Quest. The sibling demo
`src/demo/caustic` is the WebGL port (no WebGPU needed); use it wherever WebGPU or WebXR-WebGPU is unavailable.
There is deliberately no WebGL fallback in this demo: the caustics are a compute shader.

## What is original

`src/original/` is the original `src/` of the experiment, unchanged apart from the module specifiers (see below) and
the removed `main.js` (kept for reference as `main.original.js.txt`). That includes:

- `optics.js` - compute-shader photon sheets refracted through the wave field, blurred into caustic maps (water and sphere).
- `room.js`, `stone-geometry.js`, `architecture.js` - the stepped rotunda, columns, plinth, moss.
- `water.js`, `water-reflection.js`, `crystal-optics.js` - Fresnel/Snell water surface and the **reflective, refractive glass sphere** (kept).
- `marine-life.js`, `fish-*.js`, `algae-*.js` - boid fish schools and algae.
- `particles.js`, `particle-light-field.js`, `light-shafts.js` - motes and volumetric sun beams.
- `post-processing.js` - deferred scene pass, SSR with temporal denoise, SMAA, bloom, colour grading.
- `camera-views.js`, `settings.js` - camera presets and the lil-gui settings panel.

## What is ours

- `src/app.js` - the original `main.js`, adapted: our page and toolbar, underwater sound, VR branch, `setAnimationLoop`.
- `src/vr.js` - WebXR session, rig, stick locomotion, controller ripples, in-scene fog.
- `src/audio.js` - the shared `AudioHandler`: ocean loop above the surface, underwater loop below it, crossfaded by head height.
- `public/src/demo/caustic_webgpu/index.html` - page; loads `commons`, `caustic_webgpu_vendor` and the demo bundle.

## Pinned Three.js (`vendor/three`)

The original runs on an unreleased Three.js commit (`mrdoob/three.js@a70ee1ad`, revision `188dev`); the installed
release (r187) lacks e.g. `temporalDenoise`. That commit's `build/three.core.js`, `three.webgpu.js`, `three.tsl.js` and
the addons the demo imports are therefore vendored in `vendor/three/` (MIT licence, see the headers). Every import of
`three`, `three/webgpu`, `three/tsl` and `three/addons/...` in this demo was rewritten to a relative path into that
folder, so the rest of the project keeps using r187. `webpack.common.js` puts the vendored code in its own
`caustic_webgpu_vendor` chunk so no other demo downloads it. To update: re-download the same files from a newer
commit and re-run the specifier rewrite.

## Controls

Desktop: drag to orbit, wheel to zoom, double-click ripples the water, `R` ripple, `Space` pause, `F` toggle the
sphere's float, `Right arrow` next view, `H` hide the UI. The settings panel is the original's.

VR (button appears only when the browser has `XRGPUBinding`): left stick moves relative to where you look, right
stick up/down swims up and down, trigger/pinch sends a ripple to where the controller ray meets the water, squeeze
pauses. You stay under the surface and out of columns, plinth, sphere and the outer wall.

## VR limits

- WebXR with WebGPU is experimental: it needs a browser exposing `XRGPUBinding` (Chrome on Android XR / desktop with
  flags, Safari on Vision Pro). Quest Browser did not ship it at the time of writing; check there before relying on it.
- Three's `RenderPipeline` cannot present through an XR layer, so inside a session the scene is drawn **directly**: same
  materials (caustics, water, sphere with its probe reflection), with simple exponential-squared fog. Screen-space
  reflections, bloom, light shafts, the particle pass and colour grading are desktop-only.
- Offscreen passes (photons, water mirror, sphere probe) run with XR switched off; the planar water reflection is
  captured from a single head-pose camera, so it is approximate for each eye.
- No hand-tracking glove here (the WebGL demo has one); controllers and pinch rays only.

## Verification notes

Built with webpack and read against the pinned XR manager. It has **not** been run in a browser with a WebGPU device
(the development sandbox had none) or on a headset, so shader compile errors, frame rate on Quest and the VR start
pose are unverified.
