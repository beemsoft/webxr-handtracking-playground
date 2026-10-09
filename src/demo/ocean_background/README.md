# Ocean Background (landing page)

Not a standalone demo: this entry renders the `webgl_water_ocean` scene as a live,
non-interactive 3D background behind `public/ocean.html` (Ocean Fun Department).

## How it works

- `OceanBackgroundSceneManager` subclasses the `webgl_water_ocean` `SceneManager` and
  overrides `isAudioEnabled()` / `isPointerSplashEnabled()` to run silently without
  window-level pointer listeners.
- A plain `WebGLRenderer` (no WebXR, no OrbitControls, pixel ratio capped at 1.25,
  `powerPreference: 'low-power'`) renders into the fixed `#ocean-bg` layer; the page
  content sits above it (`z-index: 1`) with translucent header/cards.
- The camera orbits slowly at ~1.8 m below the surface with a gentle bob, looking slightly
  upward so the caustic-lit seabed, kelp, fish schools and the patrolling shark drift by.
- Render loop mirrors `WebPageManager`: `update()` → `render` → `postUpdate()` (GPU water
  simulation + caustics). Rendering pauses while the tab is hidden.
- The scene's GLB models are requested relative to the demo folder (`assets/...`);
  `DefaultLoadingManager.setURLModifier` remaps them to `src/demo/webgl_water_ocean/assets/...`
  so they resolve from the landing page (also when deployed under a sub-folder).

## Wiring

- Webpack entry: `ocean_background` → `src/demo/ocean_background/dist/bundle.js`.
- `public/ocean.html` loads `src/demo/commons/dist/bundle.js` followed by the entry bundle.
